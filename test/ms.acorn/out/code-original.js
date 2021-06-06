// input.ts
import {ms} from "ms.acorn";
console.log("1.5 seconds", ms("1.5 seconds"));
console.log("10s", ms("10s"));
console.log("10", ms("10"));
console.log("1s", ms("1s"));
console.log("15.0 sec", ms("15.0 sec"));
console.log("1h", ms("1h"));
console.log("1 m", ms("1 m"));
console.log("1 minute", ms("1 minute"));
