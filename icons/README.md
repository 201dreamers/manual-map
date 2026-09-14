# App icon source

`app-icon.svg` is the source for every PWA icon. It lives outside `public/` so the
source file is not shipped in the build. To regenerate after editing it:

```bash
rsvg-convert -w 192 -h 192 icons/app-icon.svg -o public/pwa-192.png
rsvg-convert -w 512 -h 512 icons/app-icon.svg -o public/pwa-512.png
rsvg-convert -w 180 -h 180 icons/app-icon.svg -o public/apple-touch-icon.png

# Maskable icons must keep their artwork inside the central 80% safe zone.
magick public/pwa-512.png -resize 80% -background "#020617" \
  -gravity center -extent 512x512 public/pwa-maskable-512.png
```
