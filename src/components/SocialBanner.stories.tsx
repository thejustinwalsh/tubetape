
import { SocialBanner } from './SocialBanner';

// Use a fixed seed for visual test consistency
const STORY_SEED = 42;

export const SocialMediaPreview = () => {
    return (
        <div className="flex items-center justify-center min-h-screen bg-black p-10">
            <div className="border border-gray-700 shadow-2xl">
                <SocialBanner seed={STORY_SEED} />
            </div>
        </div>
    );
};

export const Clean = () => {
    return (
        <div className="min-h-screen bg-transparent p-20">
            <SocialBanner seed={STORY_SEED} />
        </div>
    );
};
