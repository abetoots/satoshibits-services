
# Color codes
DIM='\033[2m'       # Dimmed gray
NC='\033[0m'        # No Color

# Pipe your output to this function to dim it.
dim_text () {
   while IFS= read -r line; do
        echo -e "${DIM}${line}${NC}"  # Dim the output line
    done
}

install_jq(){
    # Check if jq (for JSON processing) is installed
    if ! command -v jq &> /dev/null; then
        echo "jq is not installed. Installing jq..."
        
        # Check for package manager and install
        if command -v apt &> /dev/null; then
            sudo apt update && sudo apt install -y jq
        elif command -v yum &> /dev/null; then
            sudo yum install -y jq
        elif command -v brew &> /dev/null; then
            brew install jq
        else
            echo "No supported package manager found. Please install jq manually."
            exit 1
        fi
    fi

    # Continue with the rest of the script
    echo "jq is installed, proceeding with the script..."
}