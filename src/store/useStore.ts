import { create } from 'zustand';
import { RobotRecord } from '../types/robot'; // We'll create this type next

interface AppState {
    robots: RobotRecord[];
    selectedPlayerRobot: RobotRecord | null;
    selectedEnemyRobot: RobotRecord | null;
    isGenerating: boolean;

    // Actions
    setRobots: (robots: RobotRecord[]) => void;
    selectPlayerRobot: (robot: RobotRecord | null) => void;
    selectEnemyRobot: (robot: RobotRecord | null) => void;
    setIsGenerating: (isGenerating: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
    robots: [],
    selectedPlayerRobot: null,
    selectedEnemyRobot: null,
    isGenerating: false,

    setRobots: (robots) => set({ robots }),
    selectPlayerRobot: (robot) => set({ selectedPlayerRobot: robot }),
    selectEnemyRobot: (robot) => set({ selectedEnemyRobot: robot }),
    setIsGenerating: (isGenerating) => set({ isGenerating }),
}));
