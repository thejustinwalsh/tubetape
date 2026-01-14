
import { useState } from 'react';

// Simple seeded PRNG (mulberry32)
function seededRandom(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function generateWaveformBars(seed?: number): number[] {
    const random = seed !== undefined ? seededRandom(seed) : Math.random;
    return Array.from({ length: 40 }, (_, i) => {
        const height = 40 + random() * 100 * Math.sin(i * 0.2) + random() * 40;
        return Math.max(20, Math.min(180, height));
    });
}

interface SocialBannerProps {
    seed?: number;
}

export const SocialBanner = ({ seed }: SocialBannerProps) => {
    const [bars] = useState(() => generateWaveformBars(seed));

    return (
        <div
            className="w-[1280px] h-[640px] relative overflow-hidden flex flex-col items-center justify-center select-none"
            style={{
                background: `linear-gradient(135deg, #050508 0%, #0a0a0f 50%, #1a0a2e 100%)`,
                fontFamily: "'Orbitron', sans-serif"
            }}
        >
            {/* Decorative Background Grid */}
            <div
                className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                    backgroundImage: `
            linear-gradient(rgba(139, 92, 246, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139, 92, 246, 0.1) 1px, transparent 1px)
          `,
                    backgroundSize: '40px 40px'
                }}
            />

            {/* Ambient Glows */}
            <div className="absolute top-[-100px] left-[-100px] w-[500px] h-[500px] bg-purple-600 rounded-full blur-[150px] opacity-20 animate-pulse" />
            <div className="absolute bottom-[-100px] right-[-100px] w-[500px] h-[500px] bg-cyan-500 rounded-full blur-[150px] opacity-20 animate-pulse" style={{ animationDelay: '1s' }} />

            {/* Main Content Container - Safe Area */}
            <div className="relative z-10 flex flex-col items-center max-w-[900px] text-center gap-6">

                {/* Repo Badge */}
                <div className="flex items-center gap-3 mb-2">
                    {/* GitHub Icon */}
                    <svg
                        viewBox="0 0 24 24"
                        width="24"
                        height="24"
                        fill="var(--color-neon-pink)"
                        className="drop-shadow-[0_0_10px_rgba(255,0,110,0.5)]"
                    >
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <span className="text-[var(--color-neon-pink)] tracking-[0.1em] text-lg font-bold font-mono drop-shadow-[0_0_10px_rgba(255,0,110,0.5)]">
                        thejustinwalsh/tubetape
                    </span>
                </div>

                {/* Title */}
                <h1
                    className="text-9xl font-black mb-1 tracking-tighter"
                    style={{
                        fontFamily: "'Russo One', sans-serif",
                        background: 'linear-gradient(to bottom right, #fff, #a5b4fc)',
                        backgroundClip: 'text',
                        WebkitBackgroundClip: 'text',
                        color: 'transparent',
                        filter: 'drop-shadow(0 0 20px rgba(139, 92, 246, 0.5))'
                    }}
                >
                    TUBETAPE
                </h1>

                {/* Subtitle / Description */}
                <p className="text-2xl text-[var(--color-cyber-100)] opacity-90 font-light tracking-wide max-w-[800px] leading-relaxed">
                    🎵 Extract, sample, and loop audio from YouTube videos with DAW-level precision
                </p>

                {/* Waveform Visualization */}
                <div className="flex items-end justify-center h-[180px] gap-[6px] w-full mt-4 px-8">
                    {bars.map((height, i) => {
                        // Alternate colors for a cyber vibe
                        const isPink = i % 3 === 0;
                        const isPurple = i % 3 === 1;
                        const color = isPink ? 'var(--color-neon-pink)' : isPurple ? 'var(--color-neon-purple)' : 'var(--color-neon-cyan)';
                        const shadowColor = isPink ? 'rgba(255, 0, 110, 0.5)' : isPurple ? 'rgba(139, 92, 246, 0.5)' : 'rgba(0, 245, 255, 0.5)';

                        return (
                            <div
                                key={i}
                                style={{
                                    height: `${height}px`,
                                    width: '12px',
                                    backgroundColor: color,
                                    borderRadius: '4px',
                                    boxShadow: `0 0 15px ${shadowColor}`,
                                    opacity: 0.9
                                }}
                            />
                        );
                    })}
                </div>

            </div>



        </div>
    );
};
