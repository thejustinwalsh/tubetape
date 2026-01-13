import { useState, useEffect, useCallback } from "react";
import { commands } from "../bindings";

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
            const result = await commands.getAppStats();
            if (result.status === "error") throw new Error(result.error);
            const appStats = result.data;
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
