use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Serialize)]
struct GenerateContentRequest {
    contents: Vec<Content>,
    #[serde(rename = "generationConfig", skip_serializing_if = "Option::is_none")]
    generation_config: Option<GenerationConfig>,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Part {
    Text { text: String },
    InlineData {
        #[serde(rename = "inlineData")]
        inline_data: InlineData,
    },
}

#[derive(Serialize)]
struct InlineData {
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub data: String,
}

#[derive(Serialize)]
struct GenerationConfig {
    #[serde(rename = "responseMimeType")]
    pub response_mime_type: String,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct RobotStatus {
    #[serde(alias = "Name", alias = "name")]
    pub name: String,
    #[serde(alias = "Lore", alias = "lore")]
    pub lore: String,
    #[serde(alias = "HP", alias = "hp")]
    pub hp: i32,
    #[serde(alias = "ATK", alias = "atk")]
    pub atk: i32,
    #[serde(alias = "DEF", alias = "def")]
    pub def: i32,
    #[serde(alias = "VisualDescription", alias = "visualDescription", alias = "visual_description")]
    pub visual_description: String,
}

#[derive(Deserialize, Debug)]
struct GenerateContentResponse {
    candidates: Vec<Candidate>,
}

#[derive(Deserialize, Debug)]
struct Candidate {
    content: CandidateContent,
}

#[derive(Deserialize, Debug)]
struct CandidateContent {
    parts: Vec<CandidatePart>,
}

#[derive(Deserialize, Debug)]
struct CandidatePart {
    text: String,
}

pub async fn generate_robot_status(base64_image: String) -> Result<RobotStatus, String> {
    let api_key = env::var("GEMINI_API_KEY")
        .map_err(|_| "GEMINI_API_KEY not found in environment variables".to_string())?;

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        api_key
    );

    let prompt = "この食べ物画像のカロリー、タンパク質、食物繊維を推定し、HP(500-2000), ATK(10-100), DEF(5-50)を算出し、架空の企業『オイシイ・インダストリー』が作った兵器という設定の概要(Lore)、ロボット名(Name)、および次の機能で使う画像生成AI(Text-to-Image)に入力するための、この食べ物をモチーフにしたメカニカルな戦闘ロボットの「詳細な外観プロンプト(VisualDescription英語)」を考えて、以下のスキーマの平坦なJSONのみを出力してください。\n\n※重要: プロンプト（VisualDescription）には、必ず「全身像であること（full body standing）」「頭の先から足先まで完全にフレーム内に収まっていること（extreme full body shot, feet completely visible）」を英語で明記してください。\n\n{\"name\": \"名前\", \"lore\": \"設定\", \"hp\": 1000, \"atk\": 50, \"def\": 20, \"visual_description\": \"プロンプト\"}";

    let request_body = GenerateContentRequest {
        contents: vec![Content {
            parts: vec![
                Part::Text {
                    text: prompt.to_string(),
                },
                Part::InlineData {
                    inline_data: InlineData {
                        mime_type: "image/png".to_string(), // または jpeg
                        data: base64_image,
                    },
                },
            ],
        }],
        generation_config: Some(GenerationConfig {
            response_mime_type: "application/json".to_string(),
        }),
    };

    let client = Client::new();
    let res = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Gemini API Error: {}", error_text));
    }

    let response_data: GenerateContentResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

    let text = &response_data
        .candidates
        .get(0)
        .ok_or("No candidates returned")?
        .content
        .parts
        .get(0)
        .ok_or("No parts returned")?
        .text;

    let status = match serde_json::from_str::<RobotStatus>(text) {
        Ok(s) => s,
        Err(e) => {
            // Fallback: search for keys if the JSON is nested
            let v: serde_json::Value = serde_json::from_str(text)
                .map_err(|e2| format!("Failed to parse JSON: {} (orig: {}) Text: {}", e2, e, text))?;
            
            fn find_string(v: &serde_json::Value, keys: &[&str]) -> Option<String> {
                if let Some(obj) = v.as_object() {
                    for (k, val) in obj {
                        if keys.contains(&k.to_lowercase().as_str()) {
                            if let Some(s) = val.as_str() {
                                return Some(s.to_string());
                            }
                        }
                        if let Some(res) = find_string(val, keys) {
                            return Some(res);
                        }
                    }
                }
                None
            }

            fn find_i32(v: &serde_json::Value, keys: &[&str]) -> Option<i32> {
                if let Some(obj) = v.as_object() {
                    for (k, val) in obj {
                        if keys.contains(&k.to_lowercase().as_str()) {
                            if let Some(n) = val.as_i64() {
                                return Some(n as i32);
                            }
                        }
                        if let Some(res) = find_i32(val, keys) {
                            return Some(res);
                        }
                    }
                }
                None
            }

            let name = find_string(&v, &["name"]).unwrap_or_else(|| "Unknown Robot".to_string());
            let lore = find_string(&v, &["lore"]).unwrap_or_else(|| "No lore available.".to_string());
            let visual_description = find_string(&v, &["visual_description", "visual_description_en"]).unwrap_or_else(|| "A standard mechanical combat robot.".to_string());
            let hp = find_i32(&v, &["hp"]).unwrap_or(1000);
            let atk = find_i32(&v, &["atk"]).unwrap_or(50);
            let def = find_i32(&v, &["def"]).unwrap_or(20);

            RobotStatus {
                name,
                lore,
                hp,
                atk,
                def,
                visual_description,
            }
        }
    };

    Ok(status)
}

#[derive(Deserialize, Debug)]
struct GenerateImageContentResponse {
    candidates: Vec<ImageCandidate>,
}

#[derive(Deserialize, Debug)]
struct ImageCandidate {
    content: ImageCandidateContent,
}

#[derive(Deserialize, Debug)]
struct ImageCandidateContent {
    parts: Vec<ImageCandidatePart>,
}

#[derive(Deserialize, Debug)]
struct ImageCandidatePart {
    #[serde(rename = "inlineData")]
    pub inline_data: Option<ImageInlineData>,
}

#[derive(Deserialize, Debug)]
struct ImageInlineData {
    pub data: String,
}

pub async fn generate_robot_image(prompt: String) -> Result<String, String> {
    let api_key = env::var("GEMINI_API_KEY")
        .map_err(|_| "GEMINI_API_KEY not found".to_string())?;

    // Use nano-banana-pro-preview instead of imagen-3
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent?key={}",
        api_key
    );

    let instruction_prompt = format!("{}, highly zoomed out, full A-pose with slightly spread arms. The ENTIRE body from the top of the head to the bottom of the feet MUST be completely visible inside the frame. Leave plenty of empty white space around the character. DO NOT crop the image at the ankles or head. single white background `#FFFFFF`, mechanical combat robot design, clear silhouette.", prompt);

    let request_body = GenerateContentRequest {
        contents: vec![Content {
            parts: vec![
                Part::Text {
                    text: instruction_prompt,
                },
            ],
        }],
        generation_config: None, // NanoBanana doesn't need responseMimeType
    };

    let client = Client::new();
    let res = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if !res.status().is_success() {
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("NanoBanana API Error: {}", error_text));
    }

    let response_data: GenerateImageContentResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse NanoBanana response JSON: {}", e))?;

    let b64 = response_data
        .candidates
        .get(0)
        .and_then(|c| c.content.parts.get(0))
        .and_then(|p| p.inline_data.as_ref())
        .map(|d| d.data.clone())
        .ok_or("No image data returned from NanoBanana API")?;

    Ok(b64)
}
