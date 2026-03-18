use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::Write;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::sleep;

#[derive(Serialize)]
struct CreateTaskRequest {
    image_url: String,
    enable_pbr: bool,
    should_remesh: bool,
    topology: String,
    target_polycount: u32,
}

#[derive(Deserialize, Debug)]
struct CreateTaskResponse {
    result: String, // This is the task_id
}

#[derive(Deserialize, Debug)]
pub struct TaskStatusResponse {
    pub id: String,
    pub status: String, // "PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED"
    pub progress: u32,
    pub model_urls: Option<ModelUrls>,
    pub task_error: Option<TaskError>,
}

#[derive(Deserialize, Debug)]
pub struct ModelUrls {
    pub glb: Option<String>,
    pub fbx: Option<String>,
    pub obj: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct TaskError {
    pub message: String,
}

/// Start an Image-to-3D task
pub async fn create_image_to_3d_task(base64_image: String) -> Result<String, String> {
    let api_key =
        env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not found".to_string())?;

    let url = "https://api.meshy.ai/openapi/v1/image-to-3d";
    let data_uri = format!("data:image/png;base64,{}", base64_image);

    let request_body = CreateTaskRequest {
        image_url: data_uri,
        enable_pbr: true,
        should_remesh: true,
        topology: "triangle".to_string(),
        target_polycount: RIGGING_SAFE_TARGET_POLYCOUNT,
    };

    let client = Client::new();
    let res = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send Meshy request: {}", e))?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Meshy API Error: {}", error_text));
    }

    let response_data: CreateTaskResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Meshy response: {}", e))?;

    Ok(response_data.result)
}

/// Check the status of a task
pub async fn get_task_status(task_id: &str) -> Result<TaskStatusResponse, String> {
    let api_key =
        env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not found".to_string())?;

    let url = format!("https://api.meshy.ai/openapi/v1/image-to-3d/{}", task_id);

    let client = Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to send task status request: {}", e))?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Meshy API Error: {}", error_text));
    }

    let response_data: TaskStatusResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse task status response: {}", e))?;

    Ok(response_data)
}

/// Helper function to poll until completed and return GLB URL
pub async fn poll_for_glb_url(app: &AppHandle, task_id: String) -> Result<String, String> {
    let mut attempts = 0;
    let max_attempts = 120; // 120 * 5s = 600s (10 minutes)

    loop {
        if attempts > max_attempts {
            return Err("Timeout waiting for Meshy AI task".to_string());
        }

        let status_res = get_task_status(&task_id).await;

        match status_res {
            Ok(status) => {
                match status.status.as_str() {
                    "SUCCEEDED" => {
                        if let Some(urls) = status.model_urls {
                            if let Some(glb) = urls.glb {
                                return Ok(glb);
                            }
                        }
                        return Err("Task succeeded but no GLB URL found in response".to_string());
                    }
                    "FAILED" => {
                        let err_msg = status
                            .task_error
                            .map(|e| e.message)
                            .unwrap_or_else(|| "Unknown error".to_string());
                        return Err(format!("Meshy Task Failed: {}", err_msg));
                    }
                    "PENDING" | "IN_PROGRESS" => {
                        let _ = app.emit(
                            "pipeline-progress",
                            format!("Image to 3D Base Model: {}%", status.progress),
                        );
                        // Wait 5 seconds before next polling
                        sleep(Duration::from_secs(5)).await;
                        attempts += 1;
                    }
                    other => {
                        return Err(format!("Unknown status: {}", other));
                    }
                }
            }
            // If the network request fails temporarily, log it and retry instead of crashing pipeline
            Err(e) => {
                println!(
                    "Transient error polling Image-to-3D task (attempt {}/{}): {}",
                    attempts, max_attempts, e
                );
                sleep(Duration::from_secs(5)).await;
                attempts += 1;
            }
        }
    }
}

// --- Rigging API ---
#[derive(Serialize)]
struct CreateRiggingRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    input_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model_url: Option<String>,
}

#[derive(Serialize)]
struct CreateRemeshRequest {
    input_task_id: String,
    target_formats: Vec<String>,
    topology: String,
    target_polycount: u32,
}

const RIGGING_SAFE_TARGET_POLYCOUNT: u32 = 150_000;

pub fn is_rigging_face_limit_error(error: &str) -> bool {
    error.contains("300,000 face limit")
        || error.contains("Face count exceeded")
        || error.contains("exceeds the 300,000 face limit")
}

pub async fn create_rigging_task(input_task_id: String) -> Result<String, String> {
    create_rigging_task_with_request(CreateRiggingRequest {
        input_task_id: Some(input_task_id),
        model_url: None,
    })
    .await
}

pub async fn create_rigging_task_from_model_url(model_url: String) -> Result<String, String> {
    create_rigging_task_with_request(CreateRiggingRequest {
        input_task_id: None,
        model_url: Some(model_url),
    })
    .await
}

async fn create_rigging_task_with_request(
    request_body: CreateRiggingRequest,
) -> Result<String, String> {
    let api_key =
        std::env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not set in .env")?;
    let client = Client::new();
    let url = "https://api.meshy.ai/openapi/v1/rigging";

    let res = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Meshy Rigging API: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Meshy Rigging API error: {} - {}", status, text));
    }

    let response_data: CreateTaskResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Meshy Rigging API response: {}", e))?;

    Ok(response_data.result)
}

pub async fn create_remesh_task(input_task_id: String) -> Result<String, String> {
    let api_key =
        std::env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not set in .env")?;
    let client = Client::new();
    let url = "https://api.meshy.ai/openapi/v1/remesh";

    let request_body = CreateRemeshRequest {
        input_task_id,
        target_formats: vec!["glb".to_string()],
        topology: "triangle".to_string(),
        target_polycount: RIGGING_SAFE_TARGET_POLYCOUNT,
    };

    let res = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Meshy Remesh API: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Meshy Remesh API error: {} - {}", status, text));
    }

    let response_data: CreateTaskResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Meshy Remesh API response: {}", e))?;

    Ok(response_data.result)
}

pub async fn get_remesh_task_status(task_id: &str) -> Result<TaskStatusResponse, String> {
    let api_key =
        env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not found".to_string())?;

    let url = format!("https://api.meshy.ai/openapi/v1/remesh/{}", task_id);
    let client = Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to send remesh status request: {}", e))?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Meshy Remesh API Error: {}", error_text));
    }

    let response_data: TaskStatusResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse remesh status response: {}", e))?;

    Ok(response_data)
}

pub async fn poll_for_remesh_glb_url(app: &AppHandle, task_id: String) -> Result<String, String> {
    let mut attempts = 0;
    let max_attempts = 120;

    loop {
        if attempts > max_attempts {
            return Err("Timeout waiting for Remesh task".to_string());
        }

        let status_res = get_remesh_task_status(&task_id).await;

        match status_res {
            Ok(status) => match status.status.as_str() {
                "SUCCEEDED" => {
                    if let Some(urls) = status.model_urls {
                        if let Some(glb) = urls.glb {
                            return Ok(glb);
                        }
                    }
                    return Err(
                        "Remesh task succeeded but no GLB URL found in response".to_string()
                    );
                }
                "FAILED" | "CANCELED" => {
                    let err_msg = status
                        .task_error
                        .map(|e| e.message)
                        .unwrap_or_else(|| "Unknown error".to_string());
                    return Err(format!("Meshy Remesh Task Failed: {}", err_msg));
                }
                "PENDING" | "IN_PROGRESS" => {
                    let _ = app.emit(
                        "pipeline-progress",
                        format!("Remeshing Model: {}%", status.progress),
                    );
                    sleep(Duration::from_secs(5)).await;
                    attempts += 1;
                }
                other => {
                    return Err(format!("Unknown remesh status: {}", other));
                }
            },
            Err(e) => {
                println!(
                    "Transient error polling Remesh task (attempt {}/{}): {}",
                    attempts, max_attempts, e
                );
                sleep(Duration::from_secs(5)).await;
                attempts += 1;
            }
        }
    }
}

pub async fn poll_for_rigging_success(app: &AppHandle, task_id: String) -> Result<(), String> {
    let api_key =
        std::env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not set in .env")?;
    let client = Client::new();
    let url = format!("https://api.meshy.ai/openapi/v1/rigging/{}", task_id);
    let mut attempts = 0;
    let max_attempts = 120;

    loop {
        let res = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await;

        match res {
            Ok(res) => {
                if !res.status().is_success() {
                    let status = res.status();
                    let text = res.text().await.unwrap_or_default();
                    return Err(format!("Meshy poll error: {} - {}", status, text));
                }

                let task_status: TaskStatusResponse = res
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse Rigging task status: {}", e))?;

                match task_status.status.as_str() {
                    "SUCCEEDED" => {
                        return Ok(());
                    }
                    "FAILED" | "CANCELED" => {
                        let err_msg = task_status
                            .task_error
                            .map(|e| e.message)
                            .unwrap_or_else(|| "No detailed message from Meshy".to_string());
                        return Err(format!(
                            "Rigging task failed or canceled. ID: {}. Reason: {}",
                            task_id, err_msg
                        ));
                    }
                    _ => {
                        // PENDING or IN_PROGRESS, continue polling
                        let _ = app.emit(
                            "pipeline-progress",
                            format!("Rigging Model: {}%", task_status.progress),
                        );
                        attempts += 1;
                    }
                }
            }
            Err(e) => {
                println!("Transient error polling Rigging task: {}", e);
                attempts += 1;
            }
        }

        if attempts > max_attempts {
            return Err("Timeout waiting for Rigging task".to_string());
        }

        sleep(Duration::from_secs(10)).await;
    }
}

// --- Animation API ---
#[derive(Serialize)]
struct CreateAnimationRequest {
    rig_task_id: String,
    action_id: u32,
}

pub async fn create_animation_task(rig_task_id: String, action_id: u32) -> Result<String, String> {
    let api_key =
        std::env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not set in .env")?;
    let client = Client::new();
    let url = "https://api.meshy.ai/openapi/v1/animations";

    let request_body = CreateAnimationRequest {
        rig_task_id,
        action_id,
    };

    let res = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Meshy Animation API: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Meshy Animation API error: {} - {}", status, text));
    }

    let response_data: CreateTaskResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Meshy Animation API response: {}", e))?;

    Ok(response_data.result)
}

#[derive(Deserialize, Debug)]
pub struct AnimationUrls {
    pub animation_glb_url: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct AnimationTaskStatusResponse {
    pub status: String,
    pub progress: Option<u32>,
    pub result: Option<AnimationUrls>,
    pub task_error: Option<TaskError>,
}

pub async fn poll_for_animation_glb(
    app: &AppHandle,
    task_id: String,
    anim_name: &str,
) -> Result<String, String> {
    let api_key =
        std::env::var("MESHY_AI_API_KEY").map_err(|_| "MESHY_AI_API_KEY not set in .env")?;
    let client = Client::new();
    let url = format!("https://api.meshy.ai/openapi/v1/animations/{}", task_id);
    let mut attempts = 0;
    let max_attempts = 120;

    loop {
        let res = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await;

        match res {
            Ok(res) => {
                if !res.status().is_success() {
                    let status = res.status();
                    let text = res.text().await.unwrap_or_default();
                    return Err(format!("Meshy poll error: {} - {}", status, text));
                }

                let task_status: AnimationTaskStatusResponse = res
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse Animation task status: {}", e))?;

                match task_status.status.as_str() {
                    "SUCCEEDED" => {
                        if let Some(result) = task_status.result {
                            if let Some(glb_url) = result.animation_glb_url {
                                return Ok(glb_url);
                            } else {
                                return Err(
                                    "Task succeeded but animation_glb_url is missing".to_string()
                                );
                            }
                        } else {
                            return Err("Task succeeded but result object is missing".to_string());
                        }
                    }
                    "FAILED" | "CANCELED" => {
                        let err_msg = task_status
                            .task_error
                            .map(|e| e.message)
                            .unwrap_or_else(|| "No detailed message from Meshy".to_string());
                        return Err(format!(
                            "Animation task failed or canceled. ID: {}. Reason: {}",
                            task_id, err_msg
                        ));
                    }
                    _ => {
                        let _ = app.emit(
                            "pipeline-progress",
                            format!(
                                "Applying Animation ({}): {}%",
                                anim_name,
                                task_status.progress.unwrap_or(0)
                            ),
                        );
                        attempts += 1;
                    }
                }
            }
            Err(e) => {
                println!("Transient error polling Animation task: {}", e);
                attempts += 1;
            }
        }

        if attempts > max_attempts {
            return Err(format!(
                "Timeout waiting for Animation task ({})",
                anim_name
            ));
        }

        sleep(Duration::from_secs(10)).await;
    }
}
pub async fn download_glb(app: AppHandle, url: String, filename: String) -> Result<String, String> {
    let client = Client::new();
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to request GLB: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Failed to download GLB: {}", res.status()));
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read bytes: {}", e))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not get app data dir: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create AppData directory: {}", e))?;

    let file_path = app_data_dir.join(&filename);
    let mut file =
        fs::File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write to file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}
