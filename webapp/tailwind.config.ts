// Tailwind v4: theme tokens are defined in globals.css via @theme.
// This config file only specifies content paths for class detection.
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
};

export default config;
