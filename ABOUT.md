# Hounsfield Development Log #1 — Building an Offline AI Radiology Assistant

Over the past few weeks I've been working on **Hounsfield**, an on-device AI radiology assistant designed around a simple belief:

**Medical AI should work anywhere, for anyone—even without the internet.**

Instead of relying entirely on cloud APIs, Hounsfield runs directly on the device using:

* Apple MLX for native iOS inference
* ONNX + WebGPU/WebAssembly for browsers and PWAs
* Local storage for studies and reports
* No mandatory cloud dependency
* No patient data leaving the device unless the user explicitly chooses to export it

This development cycle focused less on adding flashy features and more on making the application behave like software clinicians can actually trust.

Some of the improvements include:

✅ Native model unload and reload to completely reset inference memory

✅ Editable re-analysis so clinicians can refine patient context before generating another interpretation

✅ Proper cancellation during inference instead of forcing users to wait for generation to complete

✅ Fixing a subtle image decoding bug that occasionally caused the model to think no medical image had been provided

✅ Reworking the prompting strategy so the model behaves as a medical image interpretation model rather than refusing with generic "I'm not a doctor" responses

These aren't headline features.

They're reliability features.

In healthcare, trust is built one bug fix at a time.

---

One thing I've realised while building Hounsfield is that AI products are never really "finished."

Every clinical case uncovers another edge condition.

Every hospital workflow exposes another assumption.

Every deployment teaches something the simulator never could.

Rather than chasing feature count, I'm trying to build this as a continuously evolving clinical tool—iterating from real-world usage, tightening reliability, improving explainability, and reducing friction with every release.

There is still a long road ahead:

* Better multimodal reasoning
* Additional diagnostic models
* More imaging modalities
* Better device optimisation
* Workflow integration
* Clinical validation

But that's exactly what makes the journey interesting.

I'll continue documenting the engineering decisions, mistakes, experiments, and lessons here.

If you're interested in medical AI, on-device inference, radiology, MLX, ONNX, React, or simply building healthcare software that solves real clinical problems, I'd love to hear your thoughts and contributions.

This is only the beginning.
