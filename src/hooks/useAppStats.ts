import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AppStats {
    cacheSizeMb: number;
    memoryUsageMb: number;
}

interface SystemStats {
    cacheSizeMb: number;
    memoryUsageMb: number | null;
}

export function useAppStats() {
    const [stats, setStats] = useState<SystemStats>({
        cacheSizeMb: 0,
        memoryUsageMb: null,
    });

    const fetchStats = useCallback(async () => {
        try {
            const appStats = await invoke<AppStats>("get_app_stats");
            setStats({
                cacheSizeMb: appStats.cacheSizeMb,
                memoryUsageMb: Math.round(appStats.memoryUsageMb),
            });
        } catch (err) {
            console.error("Failed to fetch stats:", err);
        }
    }, []);

    useEffect(() => {
        const defered = requestAnimationFrame(() => fetchStats());
        return () => cancelAnimationFrame(defered);
    }, [fetchStats]);

    return { stats, refetch: fetchStats };
}
