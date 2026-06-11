# 백업 방법(플랜 B): 위 env 설정으로도 크롬 실행이 안 되면 이 Dockerfile로 배포.
# Render에서 새 Web Service 만들 때 Runtime을 Docker로 하면 자동 사용됨.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
CMD ["node", "server.js"]
