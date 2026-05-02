import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Draggable } from "gsap/Draggable";

if (typeof window !== "undefined") {
	gsap.registerPlugin(useGSAP, Draggable);
	// Hardware-accelerate every tween by default — fixes iOS Safari jank.
	gsap.defaults({ force3D: true });
}

export { gsap, useGSAP, Draggable };
