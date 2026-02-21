export interface RobotRecord {
    id: string;
    name: string;
    lore: string;
    hp: number;
    atk: number;
    def: number;
    original_image_path: string;
    image_path: string;
    model_path: string;
    attack_model_path: string;
    created_at: number;
    generation_time_ms: number;
}
