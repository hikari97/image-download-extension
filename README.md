# Image Pocket

Ekstensi Chrome dan Firefox untuk memindai gambar pada halaman aktif, memfilternya berdasarkan nama atau ukuran, memilih beberapa gambar, lalu mengunduh semuanya ke satu folder.

## Fitur

- Memindai elemen gambar, lazy-loaded image, dan CSS background image.
- Memfilter berdasarkan nama/format dan dimensi minimum.
- Memilih semua gambar atau hanya gambar tertentu.
- Menjaga nama file dan otomatis menghindari konflik nama.
- Menyimpan hasil di subfolder `Image Pocket` pada folder unduhan browser.
- Satu source code untuk Chrome dan Firefox.

## Build

Pastikan Node.js 18 atau lebih baru tersedia, lalu jalankan:

```bash
npm run check
npm run build
```

Hasil build dibuat di:

- `dist/chrome`
- `dist/firefox`

## Memasang di Chrome

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder `dist/chrome`.

## Memasang sementara di Firefox

1. Buka `about:debugging#/runtime/this-firefox`.
2. Klik **Load Temporary Add-on**.
3. Pilih `dist/firefox/manifest.json`.

Ekstensi sementara akan hilang setelah Firefox ditutup. Untuk distribusi permanen, paket Firefox perlu ditandatangani melalui Firefox Add-ons.

## Cara menggunakan

1. Buka halaman web yang berisi gambar.
2. Klik ikon **Image Pocket** pada toolbar browser.
3. Gunakan pencarian atau filter ukuran bila perlu.
4. Centang gambar yang ingin disimpan.
5. Klik **Unduh gambar**.

Browser tidak mengizinkan ekstensi memindai halaman internal seperti `chrome://`, `about:`, halaman toko ekstensi, dan beberapa halaman PDF bawaan.
