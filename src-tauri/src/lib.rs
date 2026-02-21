mod gemini;
mod meshy;
mod db;

use std::sync::Mutex;
use tauri::{Manager, Emitter};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn test_gemini_status(base64_image: String) -> Result<gemini::RobotStatus, String> {
    gemini::generate_robot_status(base64_image).await
}

#[tauri::command]
async fn test_imagen_generate(prompt: String) -> Result<String, String> {
    gemini::generate_robot_image(prompt).await
}

#[tauri::command]
async fn test_meshy_generate(app: tauri::AppHandle, base64_image: String) -> Result<String, String> {
    let task_id = meshy::create_image_to_3d_task(base64_image).await?;
    let glb_url = meshy::poll_for_glb_url(&app, task_id.clone()).await?;
    let filename = format!("{}.glb", task_id);
    meshy::download_glb(app, glb_url, filename).await
}

#[tauri::command]
fn get_all_robots(state: tauri::State<'_, Mutex<rusqlite::Connection>>) -> Result<Vec<db::RobotRecord>, String> {
    let conn = state.lock().map_err(|e| e.to_string())?;
    db::get_robots(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_generation_pipeline(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<rusqlite::Connection>>,
    base64_image: String,
) -> Result<db::RobotRecord, String> {
    let start_time = std::time::SystemTime::now();

    // Strip data URI prefix (e.g. "data:image/png;base64,") so every consumer gets clean base64
    let clean_base64 = if base64_image.contains(",") {
        base64_image.split(",").last().unwrap_or("").to_string()
    } else {
        base64_image.clone()
    };

    let _ = app.emit("pipeline-progress", "Analyzing food and generating stats...");
    let stats = gemini::generate_robot_status(clean_base64.clone()).await?;
    
    // We can emit partial stats to UI
    let _ = app.emit("pipeline-stats", stats.clone());

    let _ = app.emit("pipeline-progress", "Generating robot concept image...");
    let gen_image_b64 = gemini::generate_robot_image(stats.visual_description.clone()).await?;
    let _ = app.emit("pipeline-progress", "Submitting 3D Generation Task to Meshy...");
    let task_id = meshy::create_image_to_3d_task(gen_image_b64.clone()).await?;
    
    // We just poll to wait for it to finish, we don't need to download the un-animated base GLB locally.
    meshy::poll_for_glb_url(&app, task_id.clone()).await?;

    let app_data_dir = app.path().app_data_dir().unwrap();
    let original_image_filename = format!("{}_original.png", task_id);
    let generated_image_filename = format!("{}_gen.png", task_id);
    let original_image_path = app_data_dir.join(&original_image_filename);
    let generated_image_path = app_data_dir.join(&generated_image_filename);
    
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    
    // `clean_base64` was already stripped of the data URI prefix at the top
    let orig_image_bytes = STANDARD.decode(&clean_base64).map_err(|e| format!("Base64 Error (Orig): {}", e))?;
    std::fs::write(&original_image_path, orig_image_bytes).map_err(|e| e.to_string())?;

    let gen_image_bytes = STANDARD.decode(&gen_image_b64).map_err(|e| format!("Base64 Error (Gen): {}", e))?;
    std::fs::write(&generated_image_path, gen_image_bytes).map_err(|e| e.to_string())?;

    // Let frontend know we saved the images so it can show them early
    #[derive(serde::Serialize, Clone)]
    struct PartialImages {
        original_image_path: String,
        image_path: String,
    }
    let _ = app.emit("pipeline-images", PartialImages {
        original_image_path: original_image_path.to_string_lossy().to_string(),
        image_path: generated_image_path.to_string_lossy().to_string(),
    });

    // Step 4: Rig the model
    let _ = app.emit("pipeline-progress", "Creating Rigging task...");
    let rig_task_id = meshy::create_rigging_task(task_id.clone()).await?;
    meshy::poll_for_rigging_success(&app, rig_task_id.clone()).await?;

    // Step 5: Animate the rigged model (Idle = 0, Attack = 92)
    let _ = app.emit("pipeline-progress", "Creating Animation tasks (Idle and Attack)...");
    let idle_anim_task_id = meshy::create_animation_task(rig_task_id.clone(), 0).await?;
    let attack_anim_task_id = meshy::create_animation_task(rig_task_id.clone(), 92).await?;

    let (idle_url_res, attack_url_res) = tokio::join!(
        meshy::poll_for_animation_glb(&app, idle_anim_task_id.clone(), "Idle"),
        meshy::poll_for_animation_glb(&app, attack_anim_task_id.clone(), "Attack")
    );

    let idle_url = idle_url_res?;
    let attack_url = attack_url_res?;

    // Step 6: Download GLB models
    let idle_filename = format!("{}_idle.glb", task_id);
    let attack_filename = format!("{}_attack.glb", task_id);

    let idle_path = meshy::download_glb(app.clone(), idle_url, idle_filename).await?;
    let attack_path = meshy::download_glb(app.clone(), attack_url, attack_filename).await?;

    let elapsed = start_time.elapsed().unwrap_or_default().as_millis() as i64;
    let created_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;

    let new_robot = db::RobotRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name: stats.name,
        lore: stats.lore,
        hp: stats.hp,
        atk: stats.atk,
        def: stats.def,
        original_image_path: original_image_path.to_string_lossy().to_string(),
        image_path: generated_image_path.to_string_lossy().to_string(),
        model_path: idle_path,
        attack_model_path: attack_path,
        created_at,
        generation_time_ms: elapsed,
    };

    let conn = state.lock().map_err(|e| e.to_string())?;
    db::insert_robot(&conn, &new_robot).map_err(|e| e.to_string())?;

    Ok(new_robot)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv(); // Load .env file

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app_data_dir");
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app_data_dir");
            let db_path = app_data_dir.join("robots.db");
            
            let conn = db::init_db(&db_path).expect("Failed to init database");
            app.manage(Mutex::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            test_gemini_status,
            test_imagen_generate,
            test_meshy_generate,
            get_all_robots,
            run_generation_pipeline
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
