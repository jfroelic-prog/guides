# Guides Site Kit (for StepSnap exports)

A self-maintaining GitHub Pages site: upload a guide's HTML file and the
searchable homepage updates itself about a minute later.

## One-time setup (~5 minutes, all in the browser)

1. Create a free GitHub account, then a new **public** repository named `guides`.
2. On the repo page: **Add file → Upload files** — drag in everything from this
   kit (`index.html`, `build_index.py`, and the `.github` folder*) and click
   **Commit changes**.
3. Go to **Settings → Pages**, set Source to **Deploy from a branch**,
   pick `main` and `/ (root)`, and save.
4. Your site is live at `https://YOURNAME.github.io/guides/`

*If your computer hides the `.github` folder, upload via **Add file → Create
new file**, type `.github/workflows/index.yml` as the name, and paste that
file's contents instead.

## Your workflow from then on

1. In StepSnap: finish the guide → **Export HTML guide**.
2. In GitHub: **Add file → Upload files** → drop the exported .html → Commit.
3. ~1 minute later it appears on the homepage, searchable by its title and
   description. That's it.

To update a guide, upload the new export with the **same filename** — it
replaces the old one and the index refreshes automatically. To remove a
guide, delete its file in GitHub.

## Notes

- Keep each guide as one `.html` file in the repo root (exactly how StepSnap
  exports them).
- Filenames become URLs: `vpn-setup.html` → `.../guides/vpn-setup.html` —
  lowercase-with-hyphens looks best.
- The homepage and any individual guide URL can be embedded in Google Sites
  via Insert → Embed → By URL → Whole page.
