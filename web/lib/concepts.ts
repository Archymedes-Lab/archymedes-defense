import "server-only";
import type { ConceptKind } from "@/components/three/concepts";

/** Plain-language framing for research-stage projects. Illustrations only; nothing here is measured. */
export const CONCEPTS: Record<ConceptKind, { headline: string; lede: string; scene: string; firstStep: string; dataNote: string }> = {
  "ai-evaluation": {
    headline: "Prove a defense AI system still works after every change.",
    lede: "Suppliers run private, rights-cleared benchmarks on each model release. Results are bound to exact versions, so a regression cannot hide behind a changed test.",
    scene: "Each block is one task in a private benchmark suite. Height is the pass rate. Red marks a regression since the last release.",
    firstStep: "EvalEvidence and DataScope already compare version-bound evaluation receipts and check dataset purpose and lineage. Next: one supplier with a real held-out task set.",
    dataNote: "Illustrative layout. No benchmark results are shown.",
  },
  subsea: {
    headline: "Hear what happens along a seabed cable.",
    lede: "Fiber sensing turns an existing cable into a long line of vibration and strain sensors. The value is in operator-confirmed events: which signal was an anchor and which was a storm.",
    scene: "The cable runs from a landing station across the seabed. Orange points are example sensing events along it.",
    firstStep: "Needs an operator, an interrogator and confirmed event labels. Public demonstrations do not give us access.",
    dataNote: "Illustrative. No cable or sensing data is used.",
  },
  provenance: {
    headline: "Know where an electronic part really came from.",
    lede: "Each hand-off from manufacturer lot to defense supplier is recorded by the party that made it, and laboratory inspections confirm the physical part. A record alone never proves a part is genuine.",
    scene: "A circuit board with one part under verification, and the custody chain it travelled through.",
    firstStep: "VisA PCB inspection images (CC BY 4.0) can seed an inspection-evaluation baseline. The moat needs manufacturers and labs that sign their claims.",
    dataNote: "Illustrative. No supplier or inspection records are used.",
  },
  qualification: {
    headline: "Shorten the evidence trail to qualify a part.",
    lede: "Process specs, build lots and test results form a graph. Accepted and rejected outcomes accumulate, so the next qualification starts from evidence rather than from scratch.",
    scene: "A process spec feeds two build lots. Their tests lead to an accepted or rejected outcome.",
    firstStep: "NIST AM-Bench offers public benchmark builds with paired measurements. The moat needs one supplier and one test lab.",
    dataNote: "Illustrative graph. No qualification records are used.",
  },
  fleet: {
    headline: "Fix equipment before it fails, then confirm the repair.",
    lede: "Condition data from one equipment class is joined to maintenance records. Confirmed repairs become the labels that make the next prediction better.",
    scene: "A yard of auxiliary generators. Red marks a predicted failure, green a confirmed repair.",
    firstStep: "Needs a maintenance partner with trustworthy failure and repair histories, and permission to reuse derived outcomes.",
    dataNote: "Illustrative. No fleet or maintenance data is used.",
  },
};
export const CONCEPT_SLUGS = Object.keys(CONCEPTS) as ConceptKind[];
