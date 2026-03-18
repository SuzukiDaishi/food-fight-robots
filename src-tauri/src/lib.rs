mod db;
mod gemini;
mod meshy;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

const MAX_RIGGING_ATTEMPTS: usize = 3;

#[derive(serde::Serialize, Clone)]
struct PartialImages {
    original_image_path: String,
    image_path: String,
}

fn remove_generated_files(paths: &[PathBuf]) {
    for path in paths {
        if let Err(err) = std::fs::remove_file(path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                eprintln!("Failed to remove {}: {}", path.display(), err);
            }
        }
    }
}

fn write_pipeline_images(
    app_data_dir: &Path,
    task_id: &str,
    original_image_bytes: &[u8],
    generated_image_bytes: &[u8],
) -> Result<(PathBuf, PathBuf), String> {
    let original_image_path = app_data_dir.join(format!("{}_original.png", task_id));
    let generated_image_path = app_data_dir.join(format!("{}_gen.png", task_id));

    std::fs::write(&original_image_path, original_image_bytes).map_err(|e| e.to_string())?;
    std::fs::write(&generated_image_path, generated_image_bytes).map_err(|e| e.to_string())?;

    Ok((original_image_path, generated_image_path))
}

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
async fn test_meshy_generate(
    app: tauri::AppHandle,
    base64_image: String,
) -> Result<String, String> {
    let task_id = meshy::create_image_to_3d_task(base64_image).await?;
    let glb_url = meshy::poll_for_glb_url(&app, task_id.clone()).await?;
    let filename = format!("{}.glb", task_id);
    meshy::download_glb(app, glb_url, filename).await
}

#[tauri::command]
fn get_all_robots(
    state: tauri::State<'_, Mutex<rusqlite::Connection>>,
) -> Result<Vec<db::RobotRecord>, String> {
    let conn = state.lock().map_err(|e| e.to_string())?;
    db::get_robots(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_generation_pipeline(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<rusqlite::Connection>>,
    base64_image: String,
) -> Result<db::RobotRecord, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let start_time = std::time::SystemTime::now();

    let clean_base64 = base64_image
        .strip_prefix("data:image/png;base64,")
        .ok_or("run_generation_pipeline expects a normalized PNG data URL".to_string())?
        .to_string();

    let _ = app.emit(
        "pipeline-progress",
        "Analyzing food and generating stats...",
    );
    let stats = gemini::generate_robot_status(clean_base64.clone()).await?;

    // We can emit partial stats to UI
    let _ = app.emit("pipeline-stats", stats.clone());

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let orig_image_bytes = STANDARD
        .decode(&clean_base64)
        .map_err(|e| format!("Base64 Error (Orig): {}", e))?;
    let mut last_error = "Rigging pipeline failed before any attempt started".to_string();

    for attempt in 1..=MAX_RIGGING_ATTEMPTS {
        let mut cleanup_paths = Vec::new();
        let attempt_result: Result<(PathBuf, PathBuf, String, String), String> = async {
            let _ = app.emit(
                "pipeline-progress",
                format!(
                    "Generating robot concept image... (Attempt {}/{})",
                    attempt, MAX_RIGGING_ATTEMPTS
                ),
            );
            let gen_image_b64 = gemini::generate_robot_image(stats.visual_description.clone()).await?;

            let _ = app.emit(
                "pipeline-progress",
                format!(
                    "Submitting 3D Generation Task to Meshy... (Attempt {}/{})",
                    attempt, MAX_RIGGING_ATTEMPTS
                ),
            );
            let task_id = meshy::create_image_to_3d_task(gen_image_b64.clone()).await?;

            meshy::poll_for_glb_url(&app, task_id.clone()).await?;

            let gen_image_bytes = STANDARD
                .decode(&gen_image_b64)
                .map_err(|e| format!("Base64 Error (Gen): {}", e))?;
            let (original_image_path, generated_image_path) =
                write_pipeline_images(&app_data_dir, &task_id, &orig_image_bytes, &gen_image_bytes)?;
            cleanup_paths.push(original_image_path.clone());
            cleanup_paths.push(generated_image_path.clone());

            let _ = app.emit(
                "pipeline-images",
                PartialImages {
                    original_image_path: original_image_path.to_string_lossy().to_string(),
                    image_path: generated_image_path.to_string_lossy().to_string(),
                },
            );

            let _ = app.emit(
                "pipeline-progress",
                format!("Creating Rigging task... (Attempt {}/{})", attempt, MAX_RIGGING_ATTEMPTS),
            );
            let rig_task_id = match meshy::create_rigging_task(task_id.clone()).await {
                Ok(rig_task_id) => rig_task_id,
                Err(err) if meshy::is_rigging_face_limit_error(&err) => {
                    let _ = app.emit(
                        "pipeline-progress",
                        format!(
                            "Model exceeds Meshy rigging face limit. Remeshing before rigging... (Attempt {}/{})",
                            attempt, MAX_RIGGING_ATTEMPTS
                        ),
                    );

                    let remesh_task_id = meshy::create_remesh_task(task_id.clone()).await?;
                    let remeshed_glb_url =
                        meshy::poll_for_remesh_glb_url(&app, remesh_task_id).await?;

                    let _ = app.emit(
                        "pipeline-progress",
                        format!(
                            "Submitting remeshed model to rigging... (Attempt {}/{})",
                            attempt, MAX_RIGGING_ATTEMPTS
                        ),
                    );
                    meshy::create_rigging_task_from_model_url(remeshed_glb_url).await?
                }
                Err(err) => return Err(err),
            };
            meshy::poll_for_rigging_success(&app, rig_task_id.clone()).await?;

            let _ = app.emit(
                "pipeline-progress",
                format!(
                    "Creating Animation tasks (Idle and Attack)... (Attempt {}/{})",
                    attempt, MAX_RIGGING_ATTEMPTS
                ),
            );
            let idle_anim_task_id = meshy::create_animation_task(rig_task_id.clone(), 0).await?;
            let attack_anim_task_id = meshy::create_animation_task(rig_task_id.clone(), 92).await?;

            let (idle_url_res, attack_url_res) = tokio::join!(
                meshy::poll_for_animation_glb(&app, idle_anim_task_id.clone(), "Idle"),
                meshy::poll_for_animation_glb(&app, attack_anim_task_id.clone(), "Attack")
            );

            let idle_url = idle_url_res?;
            let attack_url = attack_url_res?;

            let idle_filename = format!("{}_idle.glb", task_id);
            let attack_filename = format!("{}_attack.glb", task_id);
            let idle_path = meshy::download_glb(app.clone(), idle_url, idle_filename).await?;
            cleanup_paths.push(PathBuf::from(&idle_path));
            let attack_path =
                meshy::download_glb(app.clone(), attack_url, attack_filename).await?;
            cleanup_paths.push(PathBuf::from(&attack_path));

            Ok((original_image_path, generated_image_path, idle_path, attack_path))
        }
        .await;

        match attempt_result {
            Ok((original_image_path, generated_image_path, idle_path, attack_path)) => {
                let elapsed = start_time.elapsed().unwrap_or_default().as_millis() as i64;
                let created_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;

                let new_robot = db::RobotRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: stats.name.clone(),
                    lore: stats.lore.clone(),
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

                return Ok(new_robot);
            }
            Err(err) => {
                last_error = err;
                remove_generated_files(&cleanup_paths);

                eprintln!(
                    "Rigging/animation pipeline attempt {}/{} failed: {}",
                    attempt, MAX_RIGGING_ATTEMPTS, last_error
                );

                if attempt < MAX_RIGGING_ATTEMPTS {
                    let _ = app.emit(
                        "pipeline-progress",
                        format!(
                            "Rigging failed on attempt {}/{}. Regenerating concept image and retrying...",
                            attempt, MAX_RIGGING_ATTEMPTS
                        ),
                    );
                }
            }
        }
    }

    Err(format!(
        "Rigging/animation failed after {} attempts. Last error: {}",
        MAX_RIGGING_ATTEMPTS, last_error
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv(); // Load .env file

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app_data_dir");
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
