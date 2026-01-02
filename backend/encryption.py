import os
from cryptography.fernet import Fernet

# In a real production environment, this key should be managed by a secret manager (KMS, Vault, etc.)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", Fernet.generate_key().decode())

cipher_suite = Fernet(ENCRYPTION_KEY.encode())

def encrypt_value(value: str) -> str:
    if not value:
        return value
    return cipher_suite.encrypt(value.encode()).decode()

def decrypt_value(value: str) -> str:
    if not value:
        return value
    try:
        return cipher_suite.decrypt(value.encode()).decode()
    except Exception:
        # Fallback for unencrypted legacy data
        return value

