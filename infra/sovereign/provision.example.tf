# Sovereign Customer Provisioning — Terraform Template
#
# This is a template, NOT auto-applied. See docs/sovereign/PROVISIONING.md
# for the manual provisioning checklist.

variable "customer_name" {
  description = "Short identifier for the sovereign customer (e.g. 'acme')"
  type        = string
}

variable "region" {
  description = "Cloud region for the sovereign deployment"
  type        = string
  default     = "us-east-1"
}

variable "db_instance_class" {
  description = "Database instance size"
  type        = string
  default     = "db.r6g.large"
}

# --- Database ---
resource "aws_db_instance" "sovereign_db" {
  identifier     = "researchone-sovereign-${var.customer_name}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class
  allocated_storage = 100
  storage_encrypted = true

  db_name  = "researchone_${var.customer_name}"
  username = "researchone_admin"

  vpc_security_group_ids = [] # Customer-specific VPC SG
  db_subnet_group_name   = "" # Customer-specific subnet group

  backup_retention_period = 30
  deletion_protection     = true

  tags = {
    Environment = "sovereign"
    Customer    = var.customer_name
    ManagedBy   = "terraform"
  }
}

# --- Redis ---
resource "aws_elasticache_replication_group" "sovereign_redis" {
  replication_group_id = "ro-sovereign-${var.customer_name}"
  description          = "ResearchOne Sovereign Redis for ${var.customer_name}"
  engine               = "redis"
  node_type            = "cache.r6g.large"
  num_cache_clusters   = 2
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = {
    Environment = "sovereign"
    Customer    = var.customer_name
  }
}

# --- Application (ECS/Fargate) ---
resource "aws_ecs_task_definition" "sovereign_app" {
  family = "researchone-sovereign-${var.customer_name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "2048"
  memory                   = "4096"

  container_definitions = jsonencode([{
    name  = "researchone"
    image = "ghcr.io/gooseyprime/researchone:sovereign-latest"
    environment = [
      { name = "DEPLOYMENT_MODE", value = "sovereign" },
      { name = "EXCLUDE_INTELLME_CLIENT", value = "true" },
      { name = "DATABASE_URL", value = "placeholder" },
      { name = "REDIS_URL", value = "placeholder" },
    ]
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/researchone-sovereign-${var.customer_name}"
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "app"
      }
    }
  }])
}
