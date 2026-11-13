# Czepeku Library

Módulo do Foundry VTT (v12/v13) com uma interface de busca melhor para as cenas prontas (paredes, luzes e sons) do **Cze and Peku** e do **Czepeku Scenes** que o Moulinette disponibiliza para assinantes.

**Nada é baixado de antemão.** O módulo lê só o catálogo, e cada cena é baixada para o servidor no momento em que você a importa. Assim, cada mundo só tem o que usa.

> Uso pessoal. O repositório não contém nenhum mapa: tudo vem da **sua** assinatura via API do Moulinette.

## Instalação

1. Instale e conecte o **Moulinette** ao Patreon, como você já faz. A biblioteca usa a sessão dele.
2. Em **Add-on Modules → Install Module**, cole em *Manifest URL*:
   ```
   https://github.com/fernandowrpg/czepeku-library/releases/latest/download/module.json
   ```
3. Ative **Czepeku Library** no mundo e clique no botão **Czepeku** na aba de Cenas (ou use `Ctrl+Shift+K`).
4. Na primeira vez, clique em **Atualizar catálogo**. Ele lê as ~13 mil cenas do Moulinette em cerca de 30 s e salva em `Data/czepeku-library/catalog.json`, um arquivo que todos os mundos compartilham. Repita quando sair pack novo.

## Como funciona

- As **miniaturas** vêm direto do Moulinette (uma requisição por pack visível), sem baixar nada.
- Ao **importar**, o módulo pede ao Moulinette os links da cena, baixa o mapa, os vídeos e os tiles, e grava no servidor em `Data/moulinette-v2/cloud/...`. É a mesma pasta do Moulinette, então o que um baixou o outro reaproveita. Depois cria a cena com paredes, luzes e sons.
- Se a cena já estiver no servidor, a importação é instantânea e não baixa nada.

## Uso

- Botão **Czepeku** no topo da aba de Cenas, ou `Ctrl+Shift+K`.
- Busca com vários termos (todos precisam bater), em português ou inglês: `taverna noite`, `dragao chuva`, `cemiterio -animated` (o `-` exclui).
- Filtros: criador, pack, hora do dia, animadas/estáticas, com luzes, com paredes, favoritas ★ e esconder já importadas.
- As **tags de variação** (night, rain, winter, blood, fog…) mostram a contagem dentro do resultado atual. Clique numa tag para combinar.
- Clique numa cena para importar (baixa na hora, se ainda não estiver no servidor). **Shift+clique** importa e abre, **Ctrl+clique** importa e ativa. Clique no nome do pack para ver o pack inteiro.
- **Importar resultados** importa em lote tudo o que está filtrado, pulando as cenas já importadas.
- Em **Ao importar** (barra lateral), você pode remover as luzes e o fog exploration e definir o padding da cena (0%, 5%, 10%, 25% ou manter o original).
- As cenas importadas vão para a pasta `Czepeku / <pack>` (configurável nas configurações do módulo).
- **Importar resultados** mostra antes o tamanho máximo que será baixado.

## Download em massa (opcional)

Para ter packs inteiros pré-baixados (por exemplo, para jogar offline), use o script `downloader/download.mjs` (Node 18+):

1. No console do Foundry (F12), como GM: `copy(game.settings.get("moulinette","session_ID"))`. Cole o valor em `downloader/session.txt` (está no `.gitignore`).
2. Rode:
   ```bash
   node downloader/download.mjs --data "C:\caminho\para\FoundryVTT\Data" --pack "tavern"
   ```
   Sem `--pack`, ele baixa tudo, cerca de 32 GB. Outras opções: `--creator`, `--no-animated`, `--concurrency`, `--index-only` (veja `--help`). O script retoma de onde parou se for interrompido.

## Desenvolvimento

- Release automática a cada push na `main` quando a versão do `module.json` muda (`.github/workflows/release.yml`).
- `node tools/check-module.mjs` valida o manifesto.
