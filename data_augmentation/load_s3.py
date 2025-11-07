# Source - https://stackoverflow.com/questions/50100221/download-file-from-aws-s3-using-python
# Posted by Taukheer
# Retrieved 11/4/2025, License - CC-BY-SA 4.0
import boto3
from boto3.session import Session
from dotenv import load_dotenv
import os


def download_file(s3_key: str):
    """
    Download a file from S3 to local storage.

    Args:
        bucket_name: Name of the S3 bucket.
        s3_key: Path to the file inside the bucket (key).
        local_path: Local file path where it should be saved.
    """
    try:
        load_dotenv()
        ACCESS_KEY = os.getenv("AWS_ACCESS_KEY_ID")
        SECRET_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
        REGION = os.getenv("AWS_DEFAULT_REGION")
        S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")
        s3 = boto3.client(
            "s3",
            aws_access_key_id=ACCESS_KEY,
            aws_secret_access_key=SECRET_KEY,
            region_name=REGION
        )
        prefix = 'html/'
        s3_key = prefix + s3_key
        save_path = 'html/' + s3_key
        s3.download_file(S3_BUCKET_NAME, s3_key, save_path)
        print(f"✅ Download successful: {save_path}")
    except Exception as e:
        print(f"❌ Failed to download file: {e}")

