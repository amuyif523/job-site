import os
import sys

sys.path.append('backend')
from pydantic import BaseModel, Field

class CVLatestResponse(BaseModel):
    has_cv: bool = Field(default=False)
    parsed_json: dict = Field(default_factory=dict)
    suggestions: list = Field(default_factory=list)

payload = CVLatestResponse()
payload.has_cv = True
print("Payload output:", payload.model_dump() if hasattr(payload, "model_dump") else payload.dict())
