-- Serifa — esquema PostgreSQL (seção 9 da especificação).
-- Copyright (©) 2026 Clara Portes
-- O navegador espelha as mesmas entidades no IndexedDB.

CREATE TABLE IF NOT EXISTS projeto (
    id             uuid PRIMARY KEY,
    titulo         varchar(300) NOT NULL CHECK (length(btrim(titulo)) > 0),
    autor          varchar(200) NOT NULL DEFAULT '',
    idioma         varchar(20)  NOT NULL DEFAULT 'pt-BR',
    modo_formato   varchar(10)  NOT NULL DEFAULT 'livro' CHECK (modo_formato IN ('livro', 'wattpad', 'ao3')),
    tamanho_pagina varchar(12)  NOT NULL DEFAULT 'a5'
                   CHECK (tamanho_pagina IN ('a4', 'a5', 'carta', 'oficio', 'livro-6x9', 'bolso-5x8', 'b5')),
    orientacao     varchar(10)  NOT NULL DEFAULT 'retrato' CHECK (orientacao IN ('retrato', 'paisagem')),
    margens        varchar(10)  NOT NULL DEFAULT 'normal'
                   CHECK (margens IN ('normal', 'estreita', 'moderada', 'larga', 'espelhada')),
    meta_diaria    integer      NOT NULL DEFAULT 1000 CHECK (meta_diaria >= 0),
    documento      jsonb        NOT NULL CHECK (documento ->> 'format' = 'serifa'),
    versao         integer      NOT NULL DEFAULT 1 CHECK (versao >= 1),
    criado_em      timestamptz  NOT NULL DEFAULT now(),
    atualizado_em  timestamptz  NOT NULL DEFAULT now(),
    CHECK (atualizado_em >= criado_em)
);
COMMENT ON TABLE projeto IS 'Projeto de escrita (documento .serifa completo em "documento").';
COMMENT ON COLUMN projeto.versao IS 'Concorrência otimista: sobe 1 a cada gravação; quem salva informa a versão que leu.';
COMMENT ON COLUMN projeto.documento IS 'Documento .serifa integral, fonte da verdade; as demais colunas são cópias para consulta.';
CREATE INDEX IF NOT EXISTS projeto_atualizado_idx ON projeto (atualizado_em DESC);

CREATE TABLE IF NOT EXISTS capitulo (
    id            uuid PRIMARY KEY,
    projeto_id    uuid         NOT NULL REFERENCES projeto (id) ON DELETE CASCADE,
    titulo        varchar(300) NOT NULL DEFAULT '',
    posicao       integer      NOT NULL CHECK (posicao >= 0),
    html          text         NOT NULL DEFAULT '',
    notas         text         NOT NULL DEFAULT '',
    status        varchar(10)  NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'revisao', 'pronto')),
    palavras      integer      NOT NULL DEFAULT 0 CHECK (palavras >= 0),
    atualizado_em timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (projeto_id, posicao) DEFERRABLE INITIALLY DEFERRED
);
COMMENT ON TABLE capitulo IS 'Capítulos de um projeto, em ordem de posição; html no subconjunto sanitizado da seção 6.';
CREATE INDEX IF NOT EXISTS capitulo_projeto_idx ON capitulo (projeto_id, posicao);

CREATE TABLE IF NOT EXISTS revisao (
    id         bigserial PRIMARY KEY,
    projeto_id uuid        NOT NULL REFERENCES projeto (id) ON DELETE CASCADE,
    numero     integer     NOT NULL CHECK (numero > 0),
    documento  jsonb       NOT NULL,
    tamanho    integer     NOT NULL CHECK (tamanho >= 0),
    criado_em  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (projeto_id, numero)
);
COMMENT ON TABLE revisao IS 'Histórico: cada gravação guarda uma revisão; o servidor mantém as 50 últimas.';
CREATE INDEX IF NOT EXISTS revisao_projeto_idx ON revisao (projeto_id, numero DESC);

CREATE TABLE IF NOT EXISTS dicionario_pessoal (
    projeto_id uuid         NOT NULL REFERENCES projeto (id) ON DELETE CASCADE,
    palavra    varchar(100) NOT NULL CHECK (length(btrim(palavra)) > 0),
    criado_em  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (projeto_id, palavra)
);
COMMENT ON TABLE dicionario_pessoal IS 'Palavras aceitas pela revisão ortográfica do projeto (comparação sem diferenciar maiúsculas).';
CREATE UNIQUE INDEX IF NOT EXISTS dicionario_pessoal_lower_idx ON dicionario_pessoal (projeto_id, lower(palavra));

CREATE TABLE IF NOT EXISTS ideia_ignorada (
    projeto_id uuid         NOT NULL REFERENCES projeto (id) ON DELETE CASCADE,
    regra      varchar(100) NOT NULL,
    trecho     varchar(500) NOT NULL,
    criado_em  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (projeto_id, regra, trecho)
);
COMMENT ON TABLE ideia_ignorada IS 'Ideias descartadas pelo autor, no formato "regra:trecho" do documento .serifa.';

CREATE TABLE IF NOT EXISTS sessao_escrita (
    id           bigserial PRIMARY KEY,
    projeto_id   uuid        NOT NULL REFERENCES projeto (id) ON DELETE CASCADE,
    capitulo_id  uuid        REFERENCES capitulo (id) ON DELETE SET NULL,
    inicio       timestamptz NOT NULL,
    fim          timestamptz,
    palavras_inicio integer  NOT NULL DEFAULT 0 CHECK (palavras_inicio >= 0),
    palavras_fim    integer  NOT NULL DEFAULT 0 CHECK (palavras_fim >= 0),
    CHECK (fim IS NULL OR fim >= inicio)
);
COMMENT ON TABLE sessao_escrita IS 'Sessões de escrita para metas diárias e estatísticas.';
CREATE INDEX IF NOT EXISTS sessao_escrita_projeto_idx ON sessao_escrita (projeto_id, inicio DESC);

CREATE TABLE IF NOT EXISTS exportacao (
    id          bigserial PRIMARY KEY,
    projeto_id  uuid        NOT NULL REFERENCES projeto (id) ON DELETE CASCADE,
    capitulo_id uuid        REFERENCES capitulo (id) ON DELETE SET NULL,
    formato     varchar(10) NOT NULL CHECK (formato IN ('wattpad', 'ao3', 'txt', 'md', 'html', 'docx', 'epub')),
    tamanho     integer     NOT NULL CHECK (tamanho >= 0),
    criado_em   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE exportacao IS 'Registro das exportações feitas (sem guardar o arquivo gerado).';
CREATE INDEX IF NOT EXISTS exportacao_projeto_idx ON exportacao (projeto_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS preferencia (
    chave         varchar(100) PRIMARY KEY CHECK (chave ~ '^[a-z0-9._-]+$'),
    valor         jsonb        NOT NULL,
    atualizado_em timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE preferencia IS 'Preferências da instalação (tema, idioma da interface, atalhos).';
