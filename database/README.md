# 가계부·자산 포트폴리오 PostgreSQL

PostgreSQL 17. 마이그레이션 원본은 `migrations/NNN_<설명>.sql` 한 곳뿐이다. 빈 Docker 볼륨에서는 최초 실행 시 모든 파일이 이름순으로 자동 적용되고, CI도 모든 파일을 순서대로 적용한다.

기존 DB에는 새 마이그레이션을 컨테이너에 마운트된 파일로 직접 적용한다.

```powershell
docker compose exec -T db psql -U money -d money -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/NNN_<설명>.sql
```

`Get-Content … | docker compose exec … psql`처럼 PowerShell 파이프로 넘기지 않는다. Windows PowerShell 5.1은 외부 프로그램으로 ASCII를 보내 한글이 `?`로 깨진다.

규칙: 모든 마이그레이션은 재실행해도 안전하게 쓴다. 병렬 브랜치는 착수 시 번호를 예약한다. 기존 데이터의 의미를 보존하고, 확인하지 못한 값은 NULL로 둔다. SQL의 한글 리터럴은 가능하면 `U&'\\XXXX'` 이스케이프를 쓴다.
