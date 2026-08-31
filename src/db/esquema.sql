-- O inventario guarda o que as APIs NAO sabem: para que serve cada maquina,
-- quem pode ver o que, qual porta e de que. As APIs sabem estado; isto sabe
-- significado.

CREATE TABLE IF NOT EXISTS papeis (
  nome  TEXT PRIMARY KEY,
  poder INTEGER NOT NULL   -- maior vence; admin=100, casa=10
);

CREATE TABLE IF NOT EXISTS usuarios (
  id      INTEGER PRIMARY KEY,
  login   TEXT NOT NULL UNIQUE,
  nome    TEXT NOT NULL,
  senha   TEXT NOT NULL,          -- scrypt, formato "scrypt$<sal>$<hash>"
  papel   TEXT NOT NULL REFERENCES papeis(nome),
  ativo   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS maquinas (
  id           INTEGER PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('vm','ct')),
  vmid         INTEGER NOT NULL UNIQUE,
  nome         TEXT NOT NULL,
  descricao    TEXT NOT NULL,
  ip           TEXT,
  onboot       INTEGER NOT NULL DEFAULT 0,
  papel_minimo TEXT NOT NULL REFERENCES papeis(nome)
);

CREATE TABLE IF NOT EXISTS servicos (
  id            INTEGER PRIMARY KEY,
  maquina_vmid  INTEGER NOT NULL REFERENCES maquinas(vmid),
  nome          TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  porta         INTEGER,
  host_checagem TEXT,
  url           TEXT,
  papel_minimo  TEXT NOT NULL REFERENCES papeis(nome)
);

CREATE TABLE IF NOT EXISTS dependencias (
  servico_id   INTEGER NOT NULL REFERENCES servicos(id),
  depende_de   INTEGER NOT NULL REFERENCES servicos(id),
  observacao   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (servico_id, depende_de)
);

CREATE TABLE IF NOT EXISTS sessoes (
  id       TEXT PRIMARY KEY,
  usuario  INTEGER NOT NULL REFERENCES usuarios(id),
  criada   TEXT NOT NULL,
  expira   TEXT NOT NULL
);

-- Existe desde ja, mesmo sem acoes de escrita nesta fatia: o login entra aqui.
CREATE TABLE IF NOT EXISTS acoes_log (
  id       INTEGER PRIMARY KEY,
  quando   TEXT NOT NULL,
  usuario  TEXT NOT NULL,
  verbo    TEXT NOT NULL,
  alvo     TEXT NOT NULL,
  ok       INTEGER NOT NULL,
  detalhe  TEXT NOT NULL DEFAULT ''
);
