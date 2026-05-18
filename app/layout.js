import './globals.css';

/**
 * Layout principal de la aplicacion.
 *
 * Este archivo define los metadatos generales, el idioma del HTML
 * y la estructura base donde se renderizan todas las paginas.
 */

export const metadata = {
  title: 'Nomada Tasks',
  description: 'Backend validation app for Nomada Moto Partes task management'
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
