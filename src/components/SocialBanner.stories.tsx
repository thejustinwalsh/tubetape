
import { SocialBanner } from './SocialBanner';

export const SocialMediaPreview = () => {
    return (
        <div className="flex items-center justify-center min-h-screen bg-black p-10">
            <div className="border border-gray-700 shadow-2xl">
                <SocialBanner />
            </div>
        </div>
    );
};

export const Clean = () => {
    return (
        <div className="min-h-screen bg-transparent p-20">
            <SocialBanner />
        </div>
    );
};
