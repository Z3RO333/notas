"""Legacy entrypoint: runs only the medium phase from the consolidated sync."""

from pyspark.sql import SparkSession

from sync_notas_to_supabase import _ensure_supabase_healthcheck, run_medium_cycle


def main() -> None:
    spark = SparkSession.builder.getOrCreate()
    _ensure_supabase_healthcheck()
    run_medium_cycle(spark)


if __name__ == "__main__":
    main()