terraform {
  required_version = ">= 1.5.0"

  required_providers {
    okta = {
      source  = "okta/okta"
      version = "~> 6.10"
    }
  }
}
