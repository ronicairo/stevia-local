window.addEventListener('DOMContentLoaded', () => {
    const showUgeBlock = () => {
        const ugeBlock = document.querySelector('.show-uge')
        const checkedInOrOut = document.querySelector("input[name='access[uge_in_out]']:checked")
        if (role.value && checkedInOrOut) {
            const inOrOutNotChecked = document.querySelector("input[name='access[uge_in_out]']:not(:checked)")

            inOrOutNotChecked.disabled = true
            ugeBlock.classList.remove('d-none')
        }
    }

    const role = document.getElementById('access_type')
    role.addEventListener('change', ev => {
        const accessPath = document.getElementById('accessPath')
        window.location.href = `${accessPath.value}?type=${ev.target.value}`
    })

    const inOrOut = document.querySelectorAll("input[name='access[uge_in_out]']")
    inOrOut.forEach(el => {
        el.addEventListener('change', () => {
            showUgeBlock()
        })
    })

    showUgeBlock()

    document.getElementById('uge').addEventListener('click', ev => {
        const ugeCheckBox = document.querySelectorAll('input[name="access[uge][]"]')
        if (ev.target.checked) {
            ugeCheckBox.forEach(el => {
                el.checked = true
            })
        } else {
            ugeCheckBox.forEach(el => {
                el.checked = false
            })
        }
    })
})