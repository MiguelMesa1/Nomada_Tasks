/**
 * Configuracion global de Tailwind CSS.
 *
 * Aqui se define que archivos escanea Tailwind, los colores reutilizables
 * del tema y los plugins adicionales del proyecto.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        nomada: {
          yellow: '#f6c514',
          black: '#171717',
          ink: '#2b2d31'
        }
      }
    }
  },
  plugins: []
};
