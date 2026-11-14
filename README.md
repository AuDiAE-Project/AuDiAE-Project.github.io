# AuDiAE Audio Examples

Demo page for **AuDiAE: Learning Audio Latents by Coupling Diffusion Priors and Decoders**.

The page includes audio reconstruction, text-to-audio generation, spectrogram comparisons, and results reported in the paper.

## Preview locally

Run `python3 -m http.server 8000` from this directory, then open <http://localhost:8000>.

## GitHub Pages

This is a static website with no build step. In **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save. The `.nojekyll` file enables direct serving of the included assets.

Keep `data.js` and `data.json` in sync when updating examples.
