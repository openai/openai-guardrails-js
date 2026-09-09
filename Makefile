.PHONY: install
install:
	npm install

.PHONY: format
format: 
	npm run format

.PHONY: lint
lint: 
	npm run lint

.PHONY: test
test: 
	npm test

.PHONY: build
build:
	npm run build

.PHONY: sync
sync:
	npm ci

.PHONY: build-docs
build-docs:
	npm run docs:build

.PHONY: serve-docs
serve-docs:
	npm run docs:dev

.PHONY: deploy-docs
deploy-docs:
	gh workflow run docs.yml --ref main
