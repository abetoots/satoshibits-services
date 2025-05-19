#!/bin/bash

# Source relative to the script not the current process' working directory
# https://stackoverflow.com/questions/59895/how-to-get-the-source-directory-of-a-bash-script-from-within-the-script-itself
BIN_DIR=$(dirname "$0")
source $BIN_DIR/utils.sh

# Constants
NAMESPACE="@satoshibits"
BASE_DIR=$(pwd)

# Usage
usage() {
    echo "Usage: $0 [-n <package_name>] [-t <package_type>] [-d <package_description>]"
    echo "  -h       Display help message."
    echo "  -n       Package name."
    echo "  -t       Package type. Can be 'node' or 'react'."
    echo "  -d       Package description."
    exit 0
}

# If script is run interactively, prompt the user interactively.
if [ -t 0 ]; then
    echo "This script will add a new package to the packages workspace."
    read -p "Enter package name: " package_name
    read -p "Enter package description: " package_description
    select package_type in "node" "react"; do
        case $package_type in
        node)
            package_type="node"
            break
            ;;
        react)
            package_type="react"
            break
            ;;
        esac
    done
else
    # Script is run non-interactively. It should be called with flags.
    while getopts ":n:t:d:h" opt; do
        case $opt in
        h)
            usage
            ;;
        n)
            package_name=$OPTARG
            ;;
        d)
            package_description=$OPTARG
            ;;
        t)
            echo "Package type: $OPTARG"
            package_type=$OPTARG
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            exit 1
            ;;
        :)
            echo "Option -$OPTARG requires an argument." >&2
            usage
            ;;
        esac
    done
    # Removes the processed flags from the positional parameters 
    # so that any remaining arguments can be handled separately if needed.
    shift $((OPTIND - 1))

    if [ $OPTIND -eq 1 ]; then
        echo "No flags were passed." >&2
        exit 1
    fi
fi




# VALIDATION

# Required. Check if package name is empty or contains only spaces
if [[ -z "$package_name" || "$package_name" =~ ^[[:space:]]*$ ]]; then
    echo "Package name cannot be empty or contain only spaces. Package name provided: $package_name"
    exit 1
fi

# Optional. Check if package type is empty or contains only spaces,
# if it is, set it to "node" by default
if [[ -z "$package_type" || "$package_type" =~ ^[[:space:]]*$ ]]; then
    package_type="node"
# Check if package type is not "node" or "react"
elif [[ "$package_type" != "node" && "$package_type" != "react" ]]; then
    echo "Package type can only be 'node' or 'react'. Package type provided: $package_type"
    exit 1
fi    

# Variables
package_dir="$BASE_DIR/packages/$package_name"

if [[ $package_type == "react" ]]; then
    package_dir="$BASE_DIR/react-packages/$package_name"
fi


# Functions
function create_package_dir() {
    mkdir "$package_dir"
}

function main() {

    create_package_dir
    install_jq

    if [[ "$package_type" == "node" ]]; then       
        cp -a "$BIN_DIR/node-template/." "$package_dir"
    fi

    if [[ "$package_type" == "react" ]]; then
        cp -a "$BIN_DIR/react-template/." "$package_dir"
    fi

    # Extract the current placeholder package name from the homepage property
    current_placeholder_name=$(jq -r '.name' "$package_dir/package.json")
    
    # Update package.json with package name, description, and homepage. Also updates the keywords to
    # include the package name.
    jq --arg package_name "$package_name" --arg package_description "$package_description" --arg current_name "$current_placeholder_name" \
        '.name = $package_name | .description = $package_description | .keywords += [$package_name] | .homepage = .homepage | .homepage = (.homepage | gsub($current_name; $package_name))' \
        "$package_dir/package.json" > tmp.$$.json && mv tmp.$$.json "$package_dir/package.json"

    # Update jsr.json with package name and description
    jq --arg package_name "$package_name" --arg package_description "$package_description" \
        '.name = $package_name | .description = $package_description' \
        "$package_dir/jsr.json" > tmp.$$.json && mv tmp.$$.json "$package_dir/jsr.json"

    pnpm i --ignore-scripts
}

main

output_json=$(cat <<EOF
{
    "package_name": "$package_name",
    "package_description": "$package_description",
    "package_type": "$package_type",
    "package_dir": "$package_dir"
}
EOF
)

echo "$output_json"