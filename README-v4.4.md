# Addie Enterprises HTML v4.4 — Inventory Schema Upgrade

## New inventory structure
- Brand
- Model / Collection
- Type
- Color
- Material / Pattern

## New dropdowns
Type includes handbags, totes, crossbody bags, wallets, luggage, shoes, scarves, sunglasses, accessories, and more.

Color includes common colors plus Other.

Material / Pattern includes Monogram Canvas, Damier, Saffiano, Intrecciato, House Check, Zucca, calfskin, patent leather, canvas, and more.

## Other support
Selecting Other reveals a free-text field for:
- Type
- Color
- Material / Pattern

## Existing inventory compatibility
Older records using:
- `category`
- `colorMaterial`

remain readable and editable. When an older item is edited and saved, the app stores the newer structured fields.

## Upload
1. Upload every file in this ZIP to the GitHub repository root.
2. Replace matching files.
3. Commit:
   `v4.4 - Add structured inventory fields`
4. Wait 2–3 minutes and refresh.

No Firebase rule changes are required.
