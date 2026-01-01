/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: ["src/**/*.stories.tsx"],
  outDir: ".ladle/build",
  addons: {
    a11y: { enabled: true },
    control: { enabled: true },
    theme: { 
      enabled: true, 
      defaultState: "dark"
    },
    width: {
      enabled: true,
      options: {
        mobile: 380,
        tablet: 768,
        app: 1000,
        desktop: 1440
      },
      defaultState: 1000
    },
    source: { enabled: true, defaultState: false }
  },
  viteConfig: ".ladle/vite.config.ts"
};
