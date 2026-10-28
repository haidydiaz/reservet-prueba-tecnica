CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username varchar(50) NOT NULL CHECK (length(btrim(username)) > 0),
  -- Formato scrypt$N$r$p$sal$hash. Nunca se guarda la contraseña en claro.
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- El nombre de usuario no distingue mayúsculas: "Admin" y "admin" son la misma cuenta.
CREATE UNIQUE INDEX users_username_unique_ci ON users (lower(username));

CREATE TABLE sessions (
  -- SHA-256 (hex) del token de la cookie. Una filtración de la tabla no permite
  -- reutilizar sesiones, porque el token original solo existe en el navegador.
  token_hash char(64) PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
