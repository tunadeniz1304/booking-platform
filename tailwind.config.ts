import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Booking.com marka mavisi + sarı vurgu
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#003580",
          700: "#002b66",
          800: "#00234f",
          900: "#001a3a",
        },
        booking: {
          blue: "#003580",
          blueDark: "#002b66",
          yellow: "#febb02",
        },
      },
    },
  },
  plugins: [],
};

export default config;
