
import React from 'react';

interface CassetteTapeProps {
    className?: string;
    animated?: boolean;
}

const CassetteTape: React.FC<CassetteTapeProps> = ({ className = "w-24 h-24", animated = false }) => {
    return (
        <svg
            className={className}
            viewBox="0 0 100 64"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {/* Outer Shell */}
            <rect x="2" y="2" width="96" height="60" rx="4" className="text-current" />

            {/* Screw Holes at corners */}
            <circle cx="6" cy="6" r="1.5" stroke="currentColor" />
            <circle cx="94" cy="6" r="1.5" stroke="currentColor" />
            <circle cx="6" cy="58" r="1.5" stroke="currentColor" />
            <circle cx="94" cy="58" r="1.5" stroke="currentColor" />

            {/* Label Area (Main Sticker) */}
            <path d="M8 8 H92 V42 H8 Z" strokeWidth="1.5" />

            {/* Central Window */}
            <rect x="30" y="16" width="40" height="20" rx="2" strokeWidth="1.5" />

            {/* Left Reel System */}
            <g transform="translate(28, 26)">
                {/* Both reels should rotate in the same direction (counter-clockwise usually) */}
                <g className={animated ? "animate-spin" : ""} style={{ animationDuration: '3s' }}>
                    {/* Reel Hub */}
                    <circle cx="0" cy="0" r="8" strokeWidth="1.5" />
                    {/* Spindles/Teeth */}
                    <path d="M0 -6 V6 M-5.2 -3 L5.2 3 M-5.2 3 L5.2 -3" strokeWidth="1" />
                </g>
            </g>

            {/* Right Reel System */}
            <g transform="translate(72, 26)">
                <g className={animated ? "animate-spin" : ""} style={{ animationDuration: '3s' }}>
                    {/* Reel Hub */}
                    <circle cx="0" cy="0" r="8" strokeWidth="1.5" />
                    {/* Spindles/Teeth */}
                    <path d="M0 -6 V6 M-5.2 -3 L5.2 3 M-5.2 3 L5.2 -3" strokeWidth="1" />
                </g>
            </g>

            {/* Removed the tape arc as requested since it's not physically accurate */}

            {/* Bottom Trapezoid / Head Area */}
            <path d="M18 62 L24 46 H76 L82 62" strokeWidth="1.5" />

            {/* Holes in the bottom area */}
            <circle cx="35" cy="54" r="2" />
            <circle cx="65" cy="54" r="2" />

            {/* Pressure Pad markers */}
            <path d="M48 58 H52" strokeWidth="2" />

        </svg>
    );
};

export default CassetteTape;
