# 🚀 ORCHESTRATOR CONTEXT: LA POCHA GAMIFICATION MVP

## 1. VISION DEL NEGOCIO (THE PITCH)
Estamos construyendo un MVP interactivo (WebApp B2B2C) para digitalizar el ocio nocturno y demostrar el ROI al CEO de "La Pocha" (una discoteca). El objetivo del software es captar leads sin fricción, fidelizar mediante un monedero de tokens (gamificación) y generar upselling en barra.
**Todo debe parecer 100% real para el usuario final y el CEO, pero por debajo NO HAY BACKEND. Todo el estado es un mock gestionado en el cliente.**

## 2. EL STACK TÉCNICO
- **Framework:** React + workers.
- **Estilos:** Tailwind CSS.
- **UI Components:** Lucide-React (iconos). Preferencia por componentes funcionales puros o integraciones ligeras tipo shadcn/ui.
- **Animaciones (CRÍTICO):** GSAP (`@gsap/react`). El proyecto tiene instaladas las skills oficiales de GSAP. Debes usarlas para interacciones fluidas, contadores dinámicos y transiciones.

## 3. ARQUITECTURA Y REGLAS DE DESARROLLO (STRICT RULES)
Eres un Tech Lead Senior. Debes aplicar las directrices de la skill `senior-frontend` bajo estas reglas estrictas:

1. **Gestión de Estado Falso (Mock State):** NUNCA pases el estado principal por props múltiples niveles. Todo el estado core del MVP debe vivir en un hook global centralizado (`src/store/useGameState.js` usando React Context API o Zustand).
   - Variables requeridas: `tokens` (inicio: 450), `streak` (inicio: 3), `currentScreen`, `songVotes`.
2. **Diseño "Electric Night":** - Fondo siempre oscuro: `bg-neutral-950` o `bg-black`.
   - Acentos: Verde Neón (`#39FF14`), Azul Eléctrico (`#7DF9FF`), Dorado (`#FFD700`) para premium/upselling.
   - Todo el UI debe estar pensado para móvil ("Thumb-friendly") con botones gigantes abajo.
3. **Animaciones con GSAP:** - Usa EXCLUSIVAMENTE el hook `useGSAP()` para integraciones en React (referencia: `gsap-react` skill).
   - Utiliza `gsap.utils.mapRange` y `gsap.utils.snap` para cálculos de barras de progreso (referencia: `gsap-utils` skill).
   - No uses CSS transitions para animaciones complejas, usa la potencia de GSAP.
4. **Idioma de la Interfaz:** NINGÚN texto dirigido al usuario final o cliente puede estar en inglés. **Toda la UI debe estar en Español.**

## 4. FLUJO DE PANTALLAS (El Viaje del Usuario)
El enrutamiento será condicional en `App.jsx` escuchando la variable `currentScreen` del estado global:
- `onboarding`: Login sin fricción (Botón Google Falso).
- `hub`: Perfil del usuario, Tokens, Racha de Fidelidad y botón de "Invitar Amigos".
- `live`: Batalla de Temas (Jukebox). Barras de progreso animadas y botón de pago "Boost" (-30 tokens).
- `menu`: Menú Secreto VIP. Catálogo de copas premium y "Fast-Track" de cola.
- `ticket`: El Ticket Activo. Una vista anti-fraude para el camarero que requiere mantener pulsado para "quemarse" visualmente.

## 5. CÓMO USAR TUS SKILLS Y HERRAMIENTAS
Como orquestador, tienes acceso a un directorio de skills (`.claude/skills/`).
- Antes de crear un componente nuevo, evalúa usar `component_generator.py` de la skill `senior-frontend`.
- Al escribir código de animación en React, consulta la skill `gsap-react`.
- Si necesitas animar el contador del reloj Anti-fraude del camarero, no uses setInterval puros, considera un tween de GSAP con `onUpdate`.
- **Pre-commit / Validación (Tu rol de Segurata):** Antes de entregar código, verifica siempre: ¿Permite este código que los Tokens bajen de cero? Si es así, corrígelo antes de mostrármelo. El saldo de tokens nunca puede ser negativo.

## 6. DESPLIEGUE (DEPLOYMENT)
La meta final de esta sesión es compilar con `npm run build` para desplegar la carpeta `/dist` en Cloudflare Pages de forma manual o mediante Wrangler. Asegúrate de que no haya errores de TypeScript o dependencias huérfanas antes de finalizar.