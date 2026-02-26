"""Legacy entrypoint: runs only the fast phase from the consolidated sync."""

from pyspark.sql import SparkSession

from sync_notas_to_supabase import _ensure_supabase_healthcheck, run_fast_cycle


def main() -> None:
    spark = SparkSession.builder.getOrCreate()
    _ensure_supabase_healthcheck()
    run_fast_cycle(spark)


if __name__ == "__main__":
    main()