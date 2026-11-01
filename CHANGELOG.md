# Histórico de versões

## 1.0.0 — 2026-11-01

Primeira versão pública do Serifa.

- Editor no estilo do Word com faixa de opções (Arquivo, Página Inicial, Inserir, Layout, Revisão, Exibir, Exportar e Configurações), capítulos, notas e situação de cada capítulo.
- Tutorial na abertura, com tela de boas-vindas, destaque animado, barra de progresso, ícones e navegação pelo teclado, que pode ser pulado ou revisto pelo botão ? Ajuda.
- Minhas histórias: cada história com nome e descrição opcional, em cartões com capítulos, palavras e data da última edição, busca, duplicar, baixar e excluir.
- Lateral com a história aberta e a lista numerada de capítulos, botão Novo capítulo, menu de opções em cada capítulo e reordenação arrastando.
- Rascunho do capítulo com situação e notas, e painel expandido com resumo, ponto de vista, meta do capítulo, estatísticas, datas e navegação entre capítulos.
- 91 fontes (77 embutidas, livres e offline) com seletor por categoria, busca, recentes e prévia.
- Cinco estilos de texto para fanfic: Pensamento, Flashback, Mensagem, Carta e Nota do autor (Ctrl+Alt+4 a 8), convertidos na exportação.
- Interface com cantos, sombras e animações suaves, cartões, botões grandes, mensagens claras e a paleta de cores do Lume nos temas claro e escuro.
- Contador de palavras em tempo real (núcleo em C compilado para WebAssembly), meta diária, palavras da sessão e janela de contagem.
- Corretor ortográfico em português com o dicionário VERO, sugestões pelo botão direito, dicionário pessoal e F7 para ligar e desligar.
- Balão de ideias para tempo verbal, concordância, pleonasmos, crase, sentido e estilo, com Shift+F7 para ligar e desligar e categorias separadas.
- Modos de formatação Livro, Wattpad e AO3, com as linhas em branco antes (e no Wattpad também depois) dos diálogos colocadas sozinhas.
- Sete tamanhos de folha, cinco margens, seis tipos de folha e temas claro e escuro.
- Exportação para Wattpad, AO3, Word (.docx), EPUB, PDF, HTML, Markdown, texto e .serifa; importação de .serifa, .docx, .txt, .md e .html.
- Importar uma pasta de PDFs, TXTs, Markdown ou Word como uma história, um capítulo por arquivo, com tela de verificação e aviso de formatos misturados.
- Exportar todos os capítulos em .zip, numa pasta com o nome da história, em Word, texto, Markdown, HTML, Wattpad ou AO3.
- Serifa para Windows: `Serifa.exe` (Go, 13 MB) com o site embutido, que abre o Serifa numa janela própria e maximizada.
- Cada história nova ganha uma pasta em Downloads; o `.serifa` é salvo lá enquanto você escreve e as exportações vão direto para ela, sem perguntar onde salvar.
- Guia Configurações: pasta das histórias, escolher outra pasta, abrir no Explorador, voltar para Downloads, pasta automática e salvamento automático.
- Servidor e API em Java 21, armazenamento em arquivos JSON ou PostgreSQL, revisões e linha de comando.
- Ferramentas de linha de comando em C (contar) e C++ (revisor).
- `visualizar.bat` para abrir no Windows sem instalar nada e publicação no GitHub Pages.
