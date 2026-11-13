# Changelog

## [1.0.0]

### Adicionado
- Biblioteca com o catálogo do Moulinette (Cze and Peku + Czepeku Scenes): busca em português e inglês, filtros por criador, pack, hora do dia, animação, luzes, paredes, tags de variação e favoritos.
- Importação sob demanda: cada cena (mapa, vídeo, tiles e JSON) só é baixada para o servidor quando você a importa, na mesma pasta do Moulinette. As próximas importações saem direto do disco.
- Clique importa, Shift+clique importa e abre, Ctrl+clique importa e ativa. Também importa em lote os resultados filtrados.
- Botão **Atualizar catálogo**, que lê o catálogo do Moulinette (~30 s) e salva em `Data/czepeku-library/catalog.json`, compartilhado por todos os mundos.
- Script opcional `downloader/download.mjs` para baixar tudo (ou packs inteiros) de uma vez.
