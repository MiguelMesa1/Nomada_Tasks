# Nomada Tasks

Aplicacion web para validar la gestion de tareas de Nomada Moto Partes usando Next.js, React, Tailwind CSS e InsForge.

## Autor

Miguel Mesa  
miguelangelmesagarzon@gmail.com

## Descripcion

Nomada Tasks permite gestionar tareas por departamentos, responsables, estados, prioridades, comentarios, archivos adjuntos, notificaciones y tareas recurrentes.

El proyecto incluye:

- Autenticacion de usuarios.
- Aprobacion de usuarios por administrador.
- Asignacion de roles y departamentos.
- Creacion y actualizacion de tareas.
- Comentarios, historial y adjuntos por tarea.
- Notificaciones internas.
- Reportes basicos por departamento, estado y prioridad.
- Funcion de InsForge para generar tareas recurrentes.

## Tecnologias

- Next.js
- React
- Tailwind CSS
- InsForge
- Lucide React

## Estructura Principal

- `app/page.js`: pantalla principal de la aplicacion.
- `app/layout.js`: layout base y metadatos del sitio.
- `app/globals.css`: estilos globales y clases reutilizables.
- `lib/insforge.js`: cliente de InsForge y constantes compartidas.
- `migrations/`: migraciones SQL del backend.
- `insforge/functions/`: funciones de backend ejecutadas en InsForge.

## Variables de Entorno

El proyecto usa variables de entorno para conectarse a InsForge.

Crea un archivo `.env.local` usando `.env.example` como referencia:

```env
NEXT_PUBLIC_INSFORGE_URL=tu-url-de-insforge
NEXT_PUBLIC_INSFORGE_ANON_KEY=tu-anon-key
```

No compartas `.env.local`, llaves privadas, tokens ni credenciales reales.

## Comandos

Instalar dependencias:

```bash
npm install
```

Ejecutar en desarrollo:

```bash
npm run dev
```

Compilar para produccion:

```bash
npm run build
```

Ejecutar version compilada:

```bash
npm start
```

## Notas de Seguridad

Este repositorio no incluye:

- `.env.local`
- Tokens o llaves privadas.
- `node_modules`
- `.next`
- Archivos de logs.
- Configuraciones locales de herramientas o agentes.

