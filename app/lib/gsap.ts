import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Draggable } from "gsap/Draggable";

if (typeof window !== "undefined") {
	gsap.registerPlugin(useGSAP, Draggable);
}

export { gsap, useGSAP, Draggable };
