# swipe-decide

「、」「,」「，」改行で区切った項目を1枚ずつカードにして、スワイプで振り分ける静的サイトです。右がいいね、左が却下、下が保留です。

- 公開先: https://konaito.github.io/swipe-decide/
- URL の決まりと結果テキストの形式: [docs/skill.md](docs/skill.md)（公開先では `skill.md`）

## 構成

ビルドはありません。`docs/` をそのまま GitHub Pages で配信します。`docs/.nojekyll` は、`skill.md` を Jekyll に HTML へ変換させないために置いています。

## 手元で動かす

```sh
cd docs && python3 -m http.server 8787
```
