from load_s3 import download_file
from Axtree import generate_axtree


def main():
  # load from DB
  # load html from s3
  # filename = 'Amazon.com _ chocolate.html'
  filename = "apple.html"
  download_file(filename)
  # generate axtree
  generate_axtree(filename)
  # predict answer

main()

# print(response)
