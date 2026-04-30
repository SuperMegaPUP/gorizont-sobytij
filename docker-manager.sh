#!/bin/bash
# Docker management script for Horizon

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

cd /home/g/gorizont-sobytij

build() {
    echo -e "${YELLOW}📦 Building Docker images...${NC}"
    docker compose -f docker-compose.yml build
    echo -e "${GREEN}✅ Build complete!${NC}"
}

start() {
    local env=${1:-dev}
    echo -e "${YELLOW}🚀 Starting $env...${NC}"
    docker compose -f docker-compose.yml up -d $env
    echo -e "${GREEN}✅ $env started!${NC}"
    show_ports
}

stop() {
    local env=${1:-dev}
    echo -e "${YELLOW}🛑 Stopping $env...${NC}"
    docker compose -f docker-compose.yml stop $env
    echo -e "${GREEN}✅ Stopped $env${NC}"
}

restart() {
    local env=${1:-dev}
    stop $env
    start $env
}

logs() {
    local env=${1:-dev}
    docker compose -f docker-compose.yml logs -f $env
}

status() {
    echo -e "${BLUE}📊 Container Status:${NC}"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep horizon
    echo ""
    show_ports
}

show_ports() {
    echo -e "${BLUE}🌐 Ports:${NC}"
    echo "  Dev:       http://localhost:3000"
    echo "  Test:      http://localhost:3001"
    echo "  Acceptance: http://localhost:3002"
}

clean() {
    echo -e "${YELLOW}🧹 Cleaning up...${NC}"
    docker compose -f docker-compose.yml down
    echo -e "${GREEN}✅ Cleaned!${NC}"
}

case "${1:-}" in
    build) build ;;
    start) start "${2:-dev}" ;;
    stop) stop "${2:-dev}" ;;
    restart) restart "${2:-dev}" ;;
    logs) logs "${2:-dev}" ;;
    status) status ;;
    clean) clean ;;
    *)
        echo "Usage: $0 {build|start|stop|restart|logs|status|clean} [env]"
        echo ""
        echo "Envs: dev, test, acceptance"
        echo ""
        echo "Examples:"
        echo "  $0 build              # Build all"
        echo "  $0 start dev          # Start dev"
        echo "  $0 start test         # Start test"
        echo "  $0 start acceptance  # Start acceptance"
        echo "  $0 status             # Show status"
        echo "  $0 clean              # Stop all"
        ;;
esac