# Czepeku Library

Módulo do Foundry VTT (v12/v13) com as cenas prontas do **Cze and Peku** e do **Czepeku Scenes**: paredes, luzes e sons configurados. As cenas são baixadas uma vez para a pasta `Data` do Foundry, e a busca roda toda local, rápida e em português.

> Uso pessoal. O repositório **não contém nenhum mapa**: os arquivos são baixados com a **sua** assinatura via API do Moulinette.

## Como funciona

1. `downloader/download.mjs` lista todos os packs de cenas que sua conta do Moulinette acessa, baixa o JSON de cada cena e os arquivos dela (mapa, vídeo, tiles), e grava tudo em `Data/moulinette-v2/cloud/...`. É a mesma pasta que o Moulinette usa, então os dois aproveitam os arquivos um do outro.
2. Ele também grava o índice em `Data/czepeku-library/index.json`. O índice fica fora da pasta do módulo para não sumir quando o módulo atualiza.
3. No Foundry, o módulo lê esse índice e importa as cenas direto dos arquivos locais.

Tamanho aproximado: **≈31 GB** (13.330 cenas, sem duplicatas). As animadas do Czepeku Scenes sozinhas ocupam ~14 GB e podem ser puladas com `--no-animated`.

## 1. Pegar o Session ID do Moulinette

No Foundry, logado como GM e com o Moulinette conectado ao Patreon, abra o console (F12) e rode:

```js
copy(game.settings.get("moulinette","session_ID"))
```

Cole o valor num arquivo `downloader/session.txt`. Esse arquivo está no `.gitignore`: **não suba ele para o GitHub**.

## 2. Baixar

Requer Node 18+.

```bash
node downloader/download.mjs --data "C:\caminho\para\FoundryVTT\Data"
```

Opções úteis:

| opção | efeito |
|---|---|
| `--pack "tavern"` | só packs cujo nome contém o texto (pode repetir) |
| `--creator "Czepeku Scenes"` | só um criador (padrão: os dois) |
| `--no-animated` | pula as cenas animadas |
| `--concurrency 8` | mais downloads em paralelo (padrão 6) |
| `--index-only` | só atualiza o índice (novos packs), sem baixar |
| `--install-module` | copia o módulo para `Data/modules` (alternativa ao manifest) |

O script pode ser interrompido e rodado de novo: ele pula o que já baixou e tenta outra vez só o que falhou (as falhas ficam listadas em `Data/czepeku-library/failures.txt`). Rode de novo de vez em quando para pegar packs novos.

**Servidor remoto:** se o Foundry roda em outra máquina, use como `--data` uma pasta local e depois copie as pastas `moulinette-v2/` e `czepeku-library/` para a `Data` do servidor. Outra opção é rodar o script direto no servidor.

## 3. Instalar o módulo

Em **Add-on Modules → Install Module**, cole em *Manifest URL*:

```
https://github.com/fernandowrpg/czepeku-library/releases/latest/download/module.json
```

Ative **Czepeku Library** no mundo.

## Uso

- Botão **Czepeku** no topo da aba de Cenas, ou `Ctrl+Shift+K`.
- Busca com vários termos (todos precisam bater), em português ou inglês: `taverna noite`, `dragao chuva`, `cemiterio -animated` (o `-` exclui).
- Filtros: pack, hora do dia, animadas/estáticas, com luzes, com paredes, favoritas ★, só baixadas e esconder já importadas.
- As **tags de variação** (night, rain, winter, blood, fog…) mostram a contagem dentro do resultado atual. Clique numa tag para combinar.
- Clique numa cena para importar. **Shift+clique** importa e abre, **Ctrl+clique** importa e ativa. Clique no nome do pack para ver o pack inteiro.
- **Importar resultados** importa em lote tudo o que está filtrado, pulando as cenas já importadas.
- As cenas importadas vão para a pasta `Czepeku / <pack>`. Dá para mudar isso na barra lateral.

## Desenvolvimento

- Release automática a cada push na `main` quando a versão do `module.json` muda (`.github/workflows/release.yml`).
- `node tools/check-module.mjs` valida o manifesto.
