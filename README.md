# Image Pocket

Ekstensi Chrome dan Firefox untuk memindai gambar pada halaman aktif, memfilternya berdasarkan nama atau ukuran, memilih beberapa gambar, lalu mengunduh semuanya ke satu folder.

## Fitur

- Memindai elemen gambar, lazy-loaded image, dan CSS background image.
- Memfilter berdasarkan nama/format dan dimensi minimum.
- Memilih semua gambar atau hanya gambar tertentu.
- Custom HTTP Referer untuk situs yang memblokir hotlink pada preview atau unduhan.
- Custom nama file dengan penomoran otomatis untuk unduhan banyak gambar.
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

Untuk sekaligus membuat arsip ZIP yang siap diunggah ke toko ekstensi, jalankan:

```bash
npm run package
```

Perintah ini menghasilkan `dist/image-pocket-chrome.zip` dan `dist/image-pocket-firefox.zip`.

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
4. Bila preview gagal, isi **HTTP Referer** dengan URL yang diharapkan server lalu klik **Terapkan**. Secara default ekstensi memakai URL halaman aktif.
5. Centang gambar yang ingin disimpan.
6. Isi **Custom nama file** bila ingin mengganti nama. Untuk beberapa gambar, ekstensi menambahkan nomor `-001`, `-002`, dan seterusnya.
7. Klik **Unduh gambar**.

Custom Referer memakai aturan header sementara untuk request gambar dan hanya aktif selama popup ekstensi terbuka. Karena itu ekstensi meminta akses ke host HTTP/HTTPS. Kosongkan kolom Referer dan klik **Terapkan** untuk menonaktifkannya.

Browser tidak mengizinkan ekstensi memindai halaman internal seperti `chrome://`, `about:`, halaman toko ekstensi, dan beberapa halaman PDF bawaan.
