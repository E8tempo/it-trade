from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DEV_JWT_SECRET = "dev-only-jwt-secret-do-not-use-in-production"


class Settings(BaseSettings):
    """Deployment-time settings (env / .env).

    Only things that are fixed for a given deployment live here. Anything the shop
    owner may want to change while the site is running (markups, contacts, delivery
    options...) is stored in the database and edited from the admin panel.

    Values come from the environment, then backend/.env (development), then the
    repository root .env (the one docker compose uses).
    """

    model_config = SettingsConfigDict(env_file=(BASE_DIR.parent / ".env", BASE_DIR / ".env"), extra="ignore")

    env: str = Field("dev", alias="APP_ENV")
    database_url: str = f"sqlite+aiosqlite:///{(BASE_DIR / 'data' / 'dev.db').as_posix()}"
    sql_echo: bool = False

    # Auth (JWT). Access tokens are short-lived, refresh tokens are rotated on every use.
    jwt_secret: SecretStr = SecretStr(DEV_JWT_SECRET)
    jwt_access_ttl_min: int = 15
    jwt_refresh_ttl_days: int = 30
    cookie_secure: bool | None = None  # default: True in prod (HTTPS), False in dev
    # Admin account created on startup if no user with this email exists
    admin_email: str = ""
    admin_password: SecretStr = SecretStr("")

    # Supplier (b2b.i-t-p.pro)
    supplier_base_url: str = "https://b2b.i-t-p.pro"
    supplier_login: str = ""
    supplier_password: SecretStr = SecretStr("")
    supplier_pricelist: int = 9  # suffix of catalog_tree_N.json / products_N.json
    # Development samples of the catalog (products with photos, in-stock ones first), 0 = off:
    catalog_sample_per_category: int = 0  # at most N products per category
    catalog_sample_limit: int = 0  # at most N products in total, spread over the root categories

    # Media
    media_root: Path = BASE_DIR / "data" / "media"
    media_url: str = "/media"

    # Worker. Supplier image downloads are limited to 5/s in total (worker + on-demand in the API).
    image_download_rps: float = 3.0
    image_ondemand_rps: float = 0.75  # per API process
    image_workers: int = 2  # CPU processes for watermark removal / encoding
    image_prefetch_out_of_stock: bool = False  # otherwise processed on first view only
    image_prefetch_gallery: bool = True  # all photos of a product, not only the main one (~5 per product)
    stock_sync_interval_min: int = 30  # supplier limit: 10/hour
    catalog_sync_hour: int = 5  # local hour, after the supplier's nightly update
    timezone: str = "Europe/Simferopol"

    @model_validator(mode="after")
    def _check_prod(self) -> "Settings":
        if self.is_prod:
            secret = self.jwt_secret.get_secret_value()
            if secret == DEV_JWT_SECRET or len(secret) < 32:
                raise ValueError("JWT_SECRET must be set to a random string of 32+ characters in production")
        return self

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def secure_cookies(self) -> bool:
        return self.is_prod if self.cookie_secure is None else self.cookie_secure

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
